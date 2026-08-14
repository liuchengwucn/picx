import { DurableObject } from "cloudflare:workers";
import { streamText, type ToolSet, toUIMessageStream } from "ai";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "#/db/schema";
import {
  createChatProvider,
  getChatModel,
  mapReasoningEffort,
} from "#/lib/chat";
import type { ChatErrorCode } from "#/lib/chat-errors";
import { GENERATION_SPECS, type GenerationJob } from "#/lib/chat-generation";
import {
  buildStepPolicy,
  type ChatStreamEnv,
  sanitizeAssistantParts,
  splitInterleavedSegments,
} from "#/lib/chat-stream";
import { RunSlot, type SlotRun } from "#/lib/run-slot";
import { StreamBuffer } from "#/lib/stream-buffer";

/**
 * 与 ai@7 createUIMessageStreamResponse 的 UI_MESSAGE_STREAM_HEADERS 保持一致，
 * 客户端 DefaultChatTransport 按 SSE 解析。
 */
const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
  "x-accel-buffering": "no",
} as const;

/** 一轮生成：RunSlot 经 SlotRun 面管理它，ChatRunner 额外只需要 buffer 订阅 */
interface ActiveRun extends SlotRun {
  buffer: StreamBuffer;
}

/**
 * 一次聊天生成的宿主。per-conversation 实例（idFromName "chat:{sessionId}" /
 * "agent:{conversationId}"），Worker 在完成鉴权/限流/用户消息落库后把
 * GenerationJob POST 过来；生成循环在这里跑，客户端断开只是响应流少一个
 * 订阅者。存活依据：到 OpenRouter 的 in-flight fetch 阻止 DO 被回收（无
 * Worker waitUntil 的 30s 上限；outbound 连接单个上限 15 分钟，逐工具步刷新）。
 * 不用 DO storage：D1 是唯一真源，deploy 打断丢内存 buffer 是接受过的残余风险。
 */
export class ChatRunner extends DurableObject<ChatStreamEnv> {
  private slot = new RunSlot<ActiveRun>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/run") {
      const job = (await request.json()) as GenerationJob;
      // supersede：同会话上一轮还在生成时（用户点「停止」后重发的路径），中止
      // 旧轮并等它把已生成的部分落完库再开新轮——避免两轮并发写 D1，也让
      // 部分回复以 TRUNCATED 形态进历史（重放口径见 buildReplayHistory）。
      // DO 不用 storage、input gate 不关，drain 窗口内会有并发请求进来：
      // 并发 POST 的交错语义（后到者连先占槽的新轮一起 drain，终态恰好一轮
      // 存活、此前各轮都被 abort）由 RunSlot 保证并有单测钉住。
      const run = await this.slot.replace(() => this.startRun(job));
      return new Response(run.buffer.subscribe(), { headers: SSE_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/stream") {
      // buffer 还在（生成中，或刚结束、DO 尚未闲置回收）→ 重放 + 跟进；
      // 已结束的重放对客户端无害：start chunk 带同一 messageId，SDK 原位覆盖；
      // 失败轮的 error chunk 会随重放让客户端每次 resume 再弹一次 toast
      // （不污染消息 parts），可接受。supersede drain 窗口内打进来的 GET
      // 订到的是旧轮 buffer（重放 + abort 截断收尾），属预期语义。
      // 从没跑过 / 已被回收 → 204，客户端静默无事发生。
      const run = this.slot.current;
      if (!run) return new Response(null, { status: 204 });
      return new Response(run.buffer.subscribe(), { headers: SSE_HEADERS });
    }

    return new Response("Not found", { status: 404 });
  }

  private startRun(job: GenerationJob): ActiveRun {
    const buffer = new StreamBuffer();
    const abort = new AbortController();
    const env = this.env;
    const db = drizzle(env.DB, { schema });
    const spec = GENERATION_SPECS[job.kind];
    const provider = createChatProvider(env);
    // web_search 是 OpenRouter server tool，key 必须叫 web_search（与原管线同）
    const tools: ToolSet = {
      // narrow 后的 job 与注册表条目同 kind，TS 无法在联合上证明，这里断言
      ...(
        spec.buildTools as (
          j: GenerationJob,
          d: typeof db,
          e: typeof env,
        ) => ToolSet
      )(job, db, env),
      ...(job.webSearch
        ? {
            web_search: provider.tools.webSearch({
              maxResults: spec.webSearchMaxResults,
            }),
          }
        : {}),
    };

    const result = streamText({
      model: getChatModel(provider, env),
      instructions: job.instructions,
      messages: job.modelMessages,
      tools,
      abortSignal: abort.signal,
      ...buildStepPolicy(spec.maxToolSteps, job.instructions),
      maxOutputTokens: 4096,
      providerOptions: {
        openrouter: { reasoning: mapReasoningEffort(job.reasoningEffort) },
      },
    });

    const uiStream = toUIMessageStream({
      stream: splitInterleavedSegments(result.stream),
      tools,
      sendSources: true,
      sendReasoning: true,
      // 不传 originalMessages：最后一条 original 是 user 时它本就不参与拼装，
      // responseMessage 即新助手消息；id 仍由 generateMessageId 保证非空。
      generateMessageId: () => crypto.randomUUID(),
      onError: (error) => {
        console.error(`[chat-runner:${job.kind}] stream error:`, error);
        return "stream_failed" satisfies ChatErrorCode;
      },
      // abort（supersede）时也会触发且带 isAborted；部分内容照样落库——
      // 一个 part 都没有时跳过（空行进历史毫无价值，重放层已有 TRUNCATED 兜底）
      onEnd: async ({ responseMessage }) => {
        const parts = sanitizeAssistantParts(
          responseMessage.parts,
          spec.keepToolOutputTypes,
        );
        if (parts.length === 0) return;
        try {
          await (
            spec.persistAssistantMessage as (
              d: typeof db,
              j: GenerationJob,
              m: { id: string; parts: unknown[] },
            ) => Promise<void>
          )(db, job, { id: responseMessage.id, parts });
        } catch (error) {
          console.error(
            `[chat-runner:${job.kind}] persist assistant message failed:`,
            error,
          );
        }
      },
    });

    // 生成循环：消费 uiStream → 编 SSE 帧 → 广播。这个 pending 的读循环
    // （连同底层到 provider 的 fetch）就是 DO 的存活凭据。
    const finished = (async () => {
      const reader = uiStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer.append(`data: ${JSON.stringify(value)}\n\n`);
        }
      } catch (error) {
        console.error(`[chat-runner:${job.kind}] generation failed:`, error);
      } finally {
        buffer.append("data: [DONE]\n\n");
        buffer.end();
      }
    })();

    return {
      buffer,
      // done 直读 buffer：生成循环 finally 里 buffer.end() 先于 finished resolve
      get done() {
        return buffer.done;
      },
      abort: () => abort.abort(),
      finished,
    };
  }
}
