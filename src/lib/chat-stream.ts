import { env, waitUntil } from "cloudflare:workers";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStaticToolUIPart,
  isStepCount,
  isToolUIPart,
  streamText,
  type TextStreamPart,
  type ToolSet,
  type ToolUIPart,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createChatProvider,
  getChatModel,
  mapReasoningEffort,
  type RateLimitResult,
} from "#/lib/chat";
import type { ChatErrorCode } from "#/lib/chat-errors";
import {
  getReviewGuestServerSession,
  isReviewGuestModeEnabled,
} from "#/lib/review-guest";

/**
 * 论文页 chatbot（/api/chat）与 assistant agent（/api/agent）共用的流式管线。
 * 两条路由只在「落哪张表、怎么鉴权、什么提示词/工具」上不同，这些差异全部收进
 * ChatStreamSpec 回调；本文件持有全部时序不变量：
 * - 前置 D1 读（鉴权/消息计数/限流/历史窗口）并发发出，buildInstructions 是唯一
 *   依赖 authorize ctx 的，挂在它后面与其余并行——串行 await 的话光校验就要吃掉
 *   5+ 次 D1 往返才轮到模型。并发只省往返，不改变对外可见的错误优先级：全部
 *   settle 后仍按 鉴权失败(404/403) → session_full(409) → rate_limited(429)
 *   的固定顺序返回。
 * - 先做完可能抛异常的准备工作（历史加载/提示词/convertToModelMessages）再写库：
 *   顺序反了的话，一条畸形消息会让用户消息已落库但请求 500，此后该会话每次重放
 *   都炸；也避免请求还没真正打到模型就先烧掉一次限流配额。
 * - streamText 先于 persistUserMessage 发出（调用一发出就在后台连 provider，
 *   TTFB 与两次 D1 写重叠），但响应必须等 persist 完成才返回：用户消息先于
 *   助手消息落库、限流计数即时生效。trade-off 见 handler 内注释。
 * - 历史重放只喂 text part 给模型（工具输出单段可达 24k 字符，整窗重放会爆上下文；
 *   完整 parts 仍存 D1 供前端回显）。唯一的例外是 spec.replayToolDigest 折出来的
 *   那一行摘要——output 被保留意味着刷新后用户还看得见卡片，模型就不能一无所知；
 *   口径见 buildReplayHistory。
 * - 断连仍落库：consumeSseStream 拿到的是 tee 出来的独立分支 + waitUntil 托住。
 *
 * channel 向后兼容：本管线不假设会话只有一个成员——成员归属完全由 spec.authorize
 * 决定（agent 侧是 conversation_members join）。将来加群聊只改 agent 路由的 spec。
 */

type Db = DrizzleD1Database<typeof schema>;

export type ChatStreamEnv = typeof env & {
  DB: D1Database;
  PAPERS_BUCKET: R2Bucket;
  CHAT_RUNNER: DurableObjectNamespace;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  CF_API_TOKEN?: string;
};

type SessionData = NonNullable<
  | Awaited<ReturnType<typeof auth.api.getSession>>
  | Awaited<ReturnType<typeof getReviewGuestServerSession>>
>;

/**
 * 两条聊天路由共用的 body 基础字段，路由用 .extend() 加自己的定位字段
 * （sessionId+paperShortId / conversationId）。
 * 只收文本 part：放行任意形状的 part 有两个后果——无 type 的 part 会让
 * convertToModelMessages 直接抛（500），而用户消息此时已落库 → 整个会话每次
 * 重放都炸；file part 还能绕过字符数限流塞进任意体积。
 */
export const chatStreamBody = z.object({
  locale: z.string().max(10).default("en"),
  // 前端设置（localStorage 记忆）。default 兜底：老客户端 / 手工请求不带也能工作
  webSearch: z.boolean().default(true),
  // 现行档位 off/low/high；medium/xhigh 仅为兼容旧缓存 bundle 的请求，照收不报错。
  // 默认 low（默认轻量思考）：不带该字段的老客户端/手工请求也带上思考
  reasoningEffort: z
    .enum(["off", "low", "medium", "high", "xhigh"])
    .default("low"),
  message: z.object({
    id: z.string().min(1),
    role: z.literal("user"),
    parts: z
      .array(z.object({ type: z.literal("text"), text: z.string().min(1) }))
      .min(1)
      .max(32),
  }),
});

export type ChatStreamBody = z.infer<typeof chatStreamBody>;

/** spec 回调统一收到的参数包 */
export interface ChatStreamArgs<TBody extends ChatStreamBody> {
  db: Db;
  env: ChatStreamEnv;
  session: SessionData;
  userId: string;
  body: TBody;
}

export type AuthorizeResult<TCtx> =
  | { ok: true; ctx: TCtx }
  | { ok: false; code: ChatErrorCode; status: number };

/**
 * 历史行的最小形状（最旧在前）；senderType/role 的映射由路由自己做。
 * role 含 "system" 只是为了跟 chatMessages.role 列的 DB 类型（含预留的 system）
 * 兼容——两条路由目前都只写 user/assistant，从不产出 system 行。
 */
export interface StoredMessageRow {
  id: string;
  role: "user" | "assistant" | "system";
  parts: unknown;
}

export interface ChatStreamSpec<TBody extends ChatStreamBody, TCtx> {
  /** 日志前缀（"chat" / "agent"） */
  logTag: string;
  bodySchema: z.ZodType<TBody>;
  /** historyWindow 不在这里：窗口大小封装在 loadHistoryRows 的查询里 */
  limits: {
    maxInputChars: number;
    maxMessages: number;
    webSearchMaxResults: number;
  };
  /**
   * 一轮回复里允许调用工具的步数上限。管线会在其上再加一步「收走全部工具」的收尾步
   * （见 buildStepPolicy），所以实际 stopWhen 是这个数 +1，这里填的就是纯工具预算。
   */
  maxToolSteps: number;
  /** 落库时保留 output 的工具 part 类型（历史回显要重建卡片的那类），默认全剥 */
  keepToolOutputTypes?: ReadonlySet<string>;
  /**
   * 历史重放时把工具 part 折成一行文本喂给模型；返回 undefined 表示不喂。
   *
   * 不变量：能折出摘要的工具必须正好是 keepToolOutputTypes 那一批。output 被保留
   * 意味着刷新后用户还能在屏幕上看见它（卡片），模型就不能对它一无所知——否则用户
   * 指着卡片问「第二篇讲什么」时，模型的上下文里一篇都没有。
   */
  replayToolDigest?: (part: ToolUIPart) => string | undefined;
  /** 归属校验；不通过时给出错误码与状态码 */
  authorize(args: ChatStreamArgs<TBody>): Promise<AuthorizeResult<TCtx>>;
  /**
   * 会话内消息总数（session_full 上限用）。与 authorize 并发执行，所以拿不到
   * ctx——必须只靠 body 里的定位字段查询；鉴权不通过时结果直接作废。
   */
  countMessages(args: ChatStreamArgs<TBody>): Promise<number>;
  checkRateLimit(db: Db, userId: string): Promise<RateLimitResult>;
  /**
   * 取最近 historyWindow 条历史，返回时最旧在前。与 authorize 并发执行，
   * 同样只靠 body 定位、不依赖 ctx。
   */
  loadHistoryRows(args: ChatStreamArgs<TBody>): Promise<StoredMessageRow[]>;
  buildInstructions(args: ChatStreamArgs<TBody>, ctx: TCtx): Promise<string>;
  /** 本地工具集；web_search 由管线按 body.webSearch 统一追加 */
  buildLocalTools(args: ChatStreamArgs<TBody>, ctx: TCtx): ToolSet;
  /** 落用户消息（幂等 upsert + 会话 touch + 首条消息回填标题，也让限流计数即时生效） */
  persistUserMessage(args: ChatStreamArgs<TBody>, ctx: TCtx): Promise<void>;
  /** 落助手消息（parts 已经过 sanitize）+ 会话 touch */
  persistAssistantMessage(
    args: ChatStreamArgs<TBody>,
    ctx: TCtx,
    message: { id: string; parts: unknown[] },
  ): Promise<void>;
}

/**
 * 恢复思考/正文的交错时间线。
 *
 * OpenRouter 做服务端多轮网页搜索时（DeepSeek V4 Flash 0731 的 agentic search，
 * 全程不产生 tool part），原始 SSE 实测（2026-08-06）是 思考→正文→来源→思考→…
 * 按轮交替到达，但 provider 整个回合的 reasoning 增量共用一个 id、text 增量共用
 * 另一个 id；AI SDK 按 id 归并 part，交错顺序在拼装环节丢失——所有思考挤成
 * 消息顶部一个 part、正文挤成另一个，落库与实时视图皆然。
 *
 * 这里在喂给 toUIMessageStream 之前拆段：
 * - 某一类（思考/正文）已经流出过内容、被另一类打断后又回来时，先结束旧段、
 *   再以新 id 开新段，拼出来的 parts 便按真实时间线交错；
 * - source（搜索来源批次）到达时截断当前正在流出的段：来源实测夹在同一个
 *   text part 的增量中间到达，不截断的话 part 粒度上它们仍会排在整段正文
 *   之后、且多批毗邻合并——前端的来源组就又挤回消息底部了。
 * 对本就用不同 id 正常分段的流是恒等变换；工具等其他 chunk 原样透传
 * （本地工具调用天然结束当前 step，provider 会自己发 end，无需截断）。
 */
export function splitInterleavedSegments<TOOLS extends ToolSet>(
  stream: ReadableStream<TextStreamPart<TOOLS>>,
): ReadableStream<TextStreamPart<TOOLS>> {
  type Kind = "reasoning" | "text";
  interface SegState {
    /** 当前段对外使用的 id（拆过段后与原始 id 不同） */
    cur: string;
    open: boolean;
    /** 当前段是否已流出过内容——只有"回流"才拆段，新开的段首个增量不拆 */
    flowed: boolean;
  }
  const states: Record<Kind, Map<string, SegState>> = {
    reasoning: new Map(),
    text: new Map(),
  };
  // 每类最近一次流出增量的原始 id（source 截断时要找到"正在流出的那个段"）
  const activeId: Record<Kind, string | null> = {
    reasoning: null,
    text: null,
  };
  let lastFlow: Kind | null = null;
  let seq = 0;

  const handle = (
    kind: Kind,
    phase: "start" | "delta" | "end",
    // 六种段事件都带 id；spread 覆写 id 的结果仍是同型 chunk，但 TS 无法在
    // 未解析的 TOOLS 泛型联合上证明这点，enqueue 处统一断言
    chunk: TextStreamPart<TOOLS> & { id: string },
    controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
  ) => {
    const map = states[kind];
    let st = map.get(chunk.id);
    if (phase === "start") {
      // 同一原始 id 二次 start（end 之后再开）也给新 id，避免归并回旧 part
      const cur = st ? `${chunk.id}#${++seq}` : chunk.id;
      map.set(chunk.id, { cur, open: true, flowed: false });
      controller.enqueue({ ...chunk, id: cur } as TextStreamPart<TOOLS>);
      return;
    }
    if (!st) {
      // 没见过 start 的 delta/end：上游异常，登记后原样放行不干预
      st = { cur: chunk.id, open: true, flowed: false };
      map.set(chunk.id, st);
    }
    if (phase === "delta") {
      // 被另一类内容打断后回来 → 结束旧段拆新段；段已被 source 截断（open=false）
      // 时也要开新段，但截断时已发过 end，不再重复
      const interrupted = lastFlow !== kind && st.flowed;
      if (interrupted || !st.open) {
        if (interrupted && st.open) {
          controller.enqueue({
            type: kind === "reasoning" ? "reasoning-end" : "text-end",
            id: st.cur,
          } as TextStreamPart<TOOLS>);
        }
        st.cur = `${chunk.id}#${++seq}`;
        st.open = true;
        controller.enqueue({
          type: kind === "reasoning" ? "reasoning-start" : "text-start",
          id: st.cur,
        } as TextStreamPart<TOOLS>);
      }
      st.flowed = true;
      lastFlow = kind;
      activeId[kind] = chunk.id;
      controller.enqueue({ ...chunk, id: st.cur } as TextStreamPart<TOOLS>);
      return;
    }
    // end：段已被截断（source 处已发过 end）就吞掉，避免同一 id 重复 end
    if (!st.open) return;
    st.open = false;
    controller.enqueue({ ...chunk, id: st.cur } as TextStreamPart<TOOLS>);
  };

  /** source 到达：截断两类里正在流出的段，让来源组按真实到达位置落在段之间 */
  const cutOpenSegments = (
    controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
  ) => {
    for (const kind of ["reasoning", "text"] as const) {
      const id = activeId[kind];
      const st = id === null ? undefined : states[kind].get(id);
      if (st?.open && st.flowed) {
        controller.enqueue({
          type: kind === "reasoning" ? "reasoning-end" : "text-end",
          id: st.cur,
        } as TextStreamPart<TOOLS>);
        st.open = false;
      }
    }
  };

  return stream.pipeThrough(
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        switch (chunk.type) {
          case "reasoning-start":
            return handle("reasoning", "start", chunk, controller);
          case "reasoning-delta":
            return handle("reasoning", "delta", chunk, controller);
          case "reasoning-end":
            return handle("reasoning", "end", chunk, controller);
          case "text-start":
            return handle("text", "start", chunk, controller);
          case "text-delta":
            return handle("text", "delta", chunk, controller);
          case "text-end":
            return handle("text", "end", chunk, controller);
          case "source":
            cutOpenSegments(controller);
            controller.enqueue(chunk);
            return;
          default:
            controller.enqueue(chunk);
        }
      },
    }),
  );
}

/**
 * 收尾步追加的指令。此时 activeTools 已被清空、模型物理上调不到工具，这条只是
 * 别让它把「我这就去搜」写一半就断掉。
 * 两处额外约束：这个模型受提示扰动就会飘语言（见 ai.ts 的语言守卫），而这条又贴在
 * 系统提示最末尾、位置最显眼，所以必须显式要求跟随用户语言；recommendPapers 也被
 * 收走了，得允许它退化成正文里的标题+链接，否则它会照 DISCOVERY_PROMPT_RULE 认定
 * 「只能用卡片展示论文」而聊了一堆用户看不到卡片的论文。
 */
const FINAL_STEP_RULE =
  "This is the final step of this reply and no tools are available. Answer now with what you already have, in the same language the user has been using. You can no longer render paper cards, so mention any paper by title with its arXiv link inline. If your findings are incomplete, briefly say what is still missing and invite the user to ask you to continue. Do not mention steps, limits, or tool mechanics.";

/**
 * prepareStep 逐步返回的覆盖项：收尾步给出这两项，其余步返回空对象表示「沿用外层设置」
 * （ai@7 对每个字段都是 `?? 外层值`，空对象与 undefined 等价）。
 */
interface StepOverrides {
  activeTools?: never[];
  instructions?: string;
}

/**
 * 一次回复的步数策略：前 maxToolSteps 步照常带工具，之后追加一步收走全部工具，
 * 逼模型用手头材料把话说完。
 *
 * 不这么做的话 stopWhen 到点会「正常」结束一条一个字都没有的助手消息：步数耗尽
 * 不是异常，onError 不触发，用户只看见思考过程里一串工具调用然后没了；更糟的是
 * 历史重放只保留 text part，没有 text part 的消息会被整条丢掉，下一轮模型看不见
 * 自己搜过什么，于是原样重搜一遍——一个能自我循环的坑。
 *
 * activeTools: [] 会让请求体里根本不带 tools 字段（ai@7 的 prepareTools 对空工具集
 * 返回 undefined），比 toolChoice:"none" 更硬，也省掉那一步的工具定义 token。
 *
 * stopWhen 与 prepareStep 一起产出，就是不让这两个数各写各的漂开：调用方只给
 * 「能调工具的步数」，加一步收尾是这里的实现细节。
 */
export function buildStepPolicy(maxToolSteps: number, instructions: string) {
  // 收尾步：被收走全部工具、只用来把话说完，所以不能吃掉工具预算，总步数 = 工具步 + 1
  const totalSteps = maxToolSteps + 1;
  return {
    // 兜底：正常路径下最后一步没有工具可调，循环会自然结束，走不到这个条件
    stopWhen: isStepCount(totalSteps),
    prepareStep: ({ stepNumber }: { stepNumber: number }): StepOverrides =>
      stepNumber >= maxToolSteps
        ? {
            activeTools: [],
            instructions: `${instructions}\n\n${FINAL_STEP_RULE}`,
          }
        : {},
  };
}

/**
 * 助手消息一个 part 都折不出来时，喂给模型的占位标记。
 * 只进模型上下文——不落库、不下发前端，用户永远看不到它。
 */
export const TRUNCATED_REPLY_MARKER =
  "[The assistant's previous reply was cut off before it produced an answer.]";

/**
 * 一次重放里所有 digest 行加起来的字符预算。
 * 单条摘要已被 MAX_REPLAY_PAPERS 封顶（实测 8 篇满字数约 1.4k 字符），但一轮回复能
 * 发出多次 recommendPapers、历史窗口又有 50 条，不设总量的话光 digest 就能到十万级
 * token。预算花光时丢的是最旧的那些行——见 buildReplayHistory。
 */
const REPLAY_DIGEST_BUDGET = 8000;

/**
 * D1 历史行 → 喂给模型的 UIMessage 窗口（最旧在前）。
 *
 * 只带 text part：工具输出单段可达 24k 字符，整窗重放会爆上下文（完整 parts 仍存
 * D1 供前端回显）。唯一的例外是 digest 折出来的那一行——见 ChatStreamSpec.replayToolDigest。
 *
 * 一个 part 都折不出来的**助手**消息换成 TRUNCATED_REPLY_MARKER，而不是整条丢掉：
 * 步数耗尽已由 buildStepPolicy 的收尾步兜住，但还有别的路径能产出没有 text part 的
 * 助手消息——maxOutputTokens 被 reasoning 吃光（finishReason "length"）、客户端中途
 * 断开。丢掉的话模型看不见自己上一轮干过什么，会把整轮工作重做一遍；给个标记既
 * 保住了轮次顺序，也明确告诉它上一轮被截断了。
 * 其余角色仍然丢弃：parts 为空的消息会让 convertToModelMessages 产出空 content，
 * provider 可能直接 400，而用户消息本来就不可能没有文本（bodySchema 只收 text part）。
 *
 * digest 是必填参数（可以显式给 undefined）：设成可选的话，调用方漏传整个折叠功能
 * 就静默消失，而 tsc 与全部测试都是绿的。
 */
export function buildReplayHistory(
  rows: StoredMessageRow[],
  digest: ((part: ToolUIPart) => string | undefined) | undefined,
): UIMessage[] {
  // digest 预算倒着花（最新一条先取）：花光时丢的是最旧的卡片，用户此刻正盯着看的
  // 那批留得住。rows 先复制再 reverse，别就地翻转调用方的数组
  let budget = REPLAY_DIGEST_BUDGET;
  return [...rows]
    .reverse()
    .map((row) => {
      // parts 是 D1 里的任意年代 JSON，不是数组就当没有（原来直接 .filter 会抛）
      const stored = Array.isArray(row.parts)
        ? (row.parts as UIMessage["parts"])
        : [];
      const parts = stored.flatMap((part) => {
        // part 同样是任意年代的 JSON：没有字符串 type 就当没有。isStaticToolUIPart
        // 会对 type 取 startsWith，一行坏数据抛出来就是这个会话此后每次请求都 500
        if (typeof (part as { type?: unknown })?.type !== "string") return [];
        if (part.type === "text") return [part];
        // 用 static 而非 isToolUIPart：后者的窄化含 DynamicToolUIPart，而 digest 按
        // `tool-${name}` 分发，dynamic-tool part 永远匹配不上，本就该跟着一起丢弃
        if (!isStaticToolUIPart(part)) return [];
        const line = digest?.(part);
        // 预算放不下就整行丢掉，不截半句：截断的摘要会让模型读到半个标题当真
        if (!line || line.length > budget) return [];
        budget -= line.length;
        return [{ type: "text" as const, text: line }];
      });
      return {
        id: row.id,
        role: row.role,
        parts:
          parts.length === 0 && row.role === "assistant"
            ? [{ type: "text" as const, text: TRUNCATED_REPLY_MARKER }]
            : parts,
      };
    })
    .filter((message) => message.parts.length > 0)
    .reverse() as UIMessage[];
}

/**
 * 落库前清洗助手消息的 parts：
 * - 工具 part 剥掉 `output`。readPaper 单次输出可达 ~190KB，存进 D1 后没有任何
 *   读者：前端只用 type/state/toolCallId 渲染状态行，重放给模型时也只保留 text
 *   part。留着它等于每行几十上百 KB 死数据，还会把 getMessages 响应注水到 MB 级。
 *   例外：keepOutputTypes 里的工具（发现类卡片工具）保留 output 供历史重建卡片。
 * - tool-web_search 连 `input` 一起剥：server tool 的 input 就是完整搜索结果
 *   （provider 的 inputSchema 是 {results}），同样内容已以 source part 另存。
 * - reasoning part 保留文本（历史回显要折叠展示思考过程），但把 streaming 态
 *   归一成 done：流在 reasoning-end 前中断时 state 会停在 streaming，原样落库
 *   的话历史回显永远显示转圈并强制展开。
 */
export function sanitizeAssistantParts(
  parts: UIMessage["parts"],
  keepOutputTypes?: ReadonlySet<string>,
): unknown[] {
  return parts.map((part) => {
    if (part.type === "reasoning" && part.state === "streaming") {
      return { ...part, state: "done" };
    }
    if (!isToolUIPart(part)) return part;
    if (keepOutputTypes?.has(part.type)) return part;
    const { output: _output, ...rest } = part as { output?: unknown };
    if (part.type === "tool-web_search") {
      const { input: _input, ...restWithoutInput } = rest as {
        input?: unknown;
      };
      return restWithoutInput;
    }
    return rest;
  });
}

/**
 * `error` 是稳定 CODE（不是给人看的文案），前端按 code 映射 i18n 文案。
 * 码表见 #/lib/chat-errors，前后端共用，新增码必须先加进那张表。
 */
function jsonError(code: ChatErrorCode, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** UIMessage parts 里的纯文本总长（限流用） */
function textLength(parts: { text: string }[]): number {
  return parts.reduce((n, p) => n + p.text.length, 0);
}

export function createChatStreamHandler<TBody extends ChatStreamBody, TCtx>(
  spec: ChatStreamSpec<TBody, TCtx>,
): (ctx: { request: Request }) => Promise<Response> {
  return async ({ request }) => {
    const appEnv = env as ChatStreamEnv;
    const db = drizzle(appEnv.DB, { schema });

    const session =
      (await auth.api.getSession({ headers: request.headers })) ??
      (isReviewGuestModeEnabled()
        ? await getReviewGuestServerSession(db)
        : null);
    if (!session) return jsonError("unauthorized", 401);
    const userId = session.user.id;

    const parsed = spec.bodySchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return jsonError("bad_request", 400);
    const body = parsed.data;

    if (textLength(body.message.parts) > spec.limits.maxInputChars) {
      return jsonError("message_too_long", 413);
    }

    const args: ChatStreamArgs<TBody> = {
      db,
      env: appEnv,
      session,
      userId,
      body,
    };

    // 前置 D1 读全部并发发出（时序不变量见文件头注释）：countMessages/
    // checkRateLimit/loadHistoryRows 只靠 body/userId 定位，不依赖 authorize 的
    // ctx；buildInstructions 是唯一依赖 ctx 的，挂在 authorize 后面与其余并行。
    const authorizePromise = spec.authorize(args);
    const instructionsPromise = authorizePromise.then((authorized) =>
      authorized.ok ? spec.buildInstructions(args, authorized.ctx) : null,
    );
    // 下面的校验提前 return 时没人 await 它；空 catch 防 unhandled rejection
    // （真正的消费处 await 到的仍是原始异常）
    void instructionsPromise.catch(() => {});

    const [authorized, messageCount, rate, historyRows] = await Promise.all([
      authorizePromise,
      spec.countMessages(args),
      spec.checkRateLimit(db, userId),
      spec.loadHistoryRows(args),
    ]);

    // 并发只省往返，不改变对外可见的错误优先级：全部 settle 后仍按
    // 鉴权失败(404/403) → session_full(409) → rate_limited(429) 的固定顺序返回
    if (!authorized.ok) return jsonError(authorized.code, authorized.status);
    const ctx = authorized.ctx;

    if (messageCount >= spec.limits.maxMessages) {
      return jsonError("session_full", 409);
    }

    if (!rate.ok) return jsonError(rate.code, 429);

    // 历史窗口（真源 D1，不信任客户端历史）；重放口径见 buildReplayHistory
    const history = buildReplayHistory(historyRows, spec.replayToolDigest);
    const uiMessages: UIMessage[] = [...history, body.message as UIMessage];

    // 先把可能抛异常的准备工作做完，再写库（顺序不变量见文件头注释）。
    // authorize 已确认 ok ⇒ instructionsPromise 走的是 buildInstructions 分支，
    // null 只出现在上面提前 return 的路径里
    const instructions = (await instructionsPromise) as string;
    // v7: convertToModelMessages 是 async 的，必须 await
    const modelMessages = await convertToModelMessages(uiMessages);

    const provider = createChatProvider(appEnv);
    // 网页搜索是 OpenRouter server tool（服务端执行）：模型自主决定调不调。
    // key 必须叫 web_search——流里回来的 toolName 就是它，对不上会被当成未知工具。
    const tools: ToolSet = {
      ...spec.buildLocalTools(args, ctx),
      ...(body.webSearch
        ? {
            web_search: provider.tools.webSearch({
              maxResults: spec.limits.webSearchMaxResults,
            }),
          }
        : {}),
    };
    const result = streamText({
      model: getChatModel(provider, appEnv),
      instructions,
      messages: modelMessages,
      tools,
      // stopWhen + prepareStep 成对给出：最后一步收走工具强制收尾，避免静默的空消息
      ...buildStepPolicy(spec.maxToolSteps, instructions),
      maxOutputTokens: 4096,
      providerOptions: {
        // thinking 档位由前端选择；off 显式 {enabled:false}，见 mapReasoningEffort
        openrouter: { reasoning: mapReasoningEffort(body.reasoningEffort) },
      },
    });

    // 故意放在 streamText 之后：streamText 调用一发出就在后台连 provider（不等流
    // 被消费），OpenRouter 的 TTFB 得以与这两次 D1 写重叠。响应仍要等 persist 完成
    // 才返回——用户消息必须先于助手消息落库、限流计数即时生效。trade-off：persist
    // 抛异常时请求照旧 500，而此刻已经白烧了一次模型调用；写库失败概率极低，
    // 换掉关键路径上的首字延迟是划算的。
    await spec.persistUserMessage(args, ctx);

    const uiStream = toUIMessageStream({
      // 拆段变换：恢复 OpenRouter 服务端搜索场景下思考/正文的交错时间线
      stream: splitInterleavedSegments(result.stream),
      tools,
      originalMessages: uiMessages,
      // OpenRouter 的网页搜索引用是 source part，默认不下发就全丢了
      sendSources: true,
      // 思考过程要流给前端折叠展示（默认虽为 true，显式写出以免升级悄悄改默认值）
      sendReasoning: true,
      // 必须显式给：没有它时响应消息的 id 会是空串（originalMessages 最后一条是
      // user，SDK 只在续写 assistant 消息时复用其 id），落库会撞主键。
      generateMessageId: () => crypto.randomUUID(),
      // 返回值会作为 error part 下发给客户端，给稳定 code 而不是原始报错文案
      // （默认实现返回 "An error occurred."，且有泄露服务端错误细节的风险）
      onError: (error) => {
        console.error(`[${spec.logTag}] stream error:`, error);
        return "stream_failed" satisfies ChatErrorCode;
      },
      // v7: onFinish 已 deprecated，改名 onEnd（形状不变，仍有 responseMessage）
      onEnd: async ({ responseMessage }) => {
        try {
          await spec.persistAssistantMessage(args, ctx, {
            id: responseMessage.id,
            parts: sanitizeAssistantParts(
              responseMessage.parts,
              spec.keepToolOutputTypes,
            ),
          });
        } catch (error) {
          // 落库失败不能炸流（此刻响应体可能已发完/已被取消）
          console.error(
            `[${spec.logTag}] persist assistant message failed:`,
            error,
          );
        }
      },
    });

    return createUIMessageStreamResponse({
      stream: uiStream,
      // 客户端断开也要落库助手消息。consumeSseStream 拿到的是
      // handleUIMessageStreamFinish 之后 tee 出来的独立分支，响应体那一路被
      // cancel 不会波及它，所以 onEnd 能拿到完整的助手消息而不是截断的。
      // 必须用 waitUntil 托住：浮动 promise 在响应结束后会被 Workers 运行时回收。
      consumeSseStream: ({ stream }) => {
        waitUntil(consumeStream({ stream }));
      },
    });
  };
}
