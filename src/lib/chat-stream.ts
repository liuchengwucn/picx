import { env, waitUntil } from "cloudflare:workers";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  isToolUIPart,
  streamText,
  type TextStreamPart,
  type ToolSet,
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
 * - 先做完可能抛异常的准备工作（历史加载/提示词/convertToModelMessages）再写库：
 *   顺序反了的话，一条畸形消息会让用户消息已落库但请求 500，此后该会话每次重放
 *   都炸；也避免请求还没真正打到模型就先烧掉一次限流配额。
 * - 历史重放只喂 text part 给模型（工具输出单段可达 24k 字符，整窗重放会爆上下文；
 *   完整 parts 仍存 D1 供前端回显）。
 * - 断连仍落库：consumeSseStream 拿到的是 tee 出来的独立分支 + waitUntil 托住。
 *
 * channel 向后兼容：本管线不假设会话只有一个成员——成员归属完全由 spec.authorize
 * 决定（agent 侧是 conversation_members join）。将来加群聊只改 agent 路由的 spec。
 */

type Db = DrizzleD1Database<typeof schema>;

export type ChatStreamEnv = typeof env & {
  DB: D1Database;
  PAPERS_BUCKET: R2Bucket;
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
  /** 归属校验；不通过时给出错误码与状态码 */
  authorize(args: ChatStreamArgs<TBody>): Promise<AuthorizeResult<TCtx>>;
  /** 会话内消息总数（session_full 上限用） */
  countMessages(args: ChatStreamArgs<TBody>, ctx: TCtx): Promise<number>;
  checkRateLimit(db: Db, userId: string): Promise<RateLimitResult>;
  /** 取最近 historyWindow 条历史，返回时最旧在前 */
  loadHistoryRows(
    args: ChatStreamArgs<TBody>,
    ctx: TCtx,
  ): Promise<StoredMessageRow[]>;
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

    const authorized = await spec.authorize(args);
    if (!authorized.ok) return jsonError(authorized.code, authorized.status);
    const ctx = authorized.ctx;

    if ((await spec.countMessages(args, ctx)) >= spec.limits.maxMessages) {
      return jsonError("session_full", 409);
    }

    const rate = await spec.checkRateLimit(db, userId);
    if (!rate.ok) return jsonError(rate.code, 429);

    // 历史窗口（真源 D1，不信任客户端历史）：重放只带文本 part，工具输出不回喂模型
    const historyRows = await spec.loadHistoryRows(args, ctx);
    const history: UIMessage[] = historyRows
      .map((row) => ({
        id: row.id,
        role: row.role,
        parts: (row.parts as UIMessage["parts"]).filter(
          (part) => part.type === "text",
        ),
      }))
      .filter((message) => message.parts.length > 0);
    const uiMessages: UIMessage[] = [...history, body.message as UIMessage];

    // 先把可能抛异常的准备工作做完，再写库（顺序不变量见文件头注释）
    const instructions = await spec.buildInstructions(args, ctx);
    // v7: convertToModelMessages 是 async 的，必须 await
    const modelMessages = await convertToModelMessages(uiMessages);

    await spec.persistUserMessage(args, ctx);

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
