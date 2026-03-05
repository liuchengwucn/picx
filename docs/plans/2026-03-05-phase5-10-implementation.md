# Phase 5-10 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现完整的论文处理流程，包括队列处理、PDF 解析、AI 集成、实时推送、前端页面和国际化

**Architecture:** 基于 Cloudflare Workers + Queues + Durable Objects 的异步处理架构，使用 SSE 实现实时状态推送，TanStack Start 构建前端

**Tech Stack:** Cloudflare Queues, Durable Objects, pdfjs-serverless, OpenAI API, Gemini API, TanStack Start, shadcn/ui, Paraglide

---

## Phase 5: Cloudflare Queues 配置

### Task 5.1: 配置 Queues 绑定

**Files:**
- Modify: `wrangler.toml`

**Step 1: 添加 Queues 配置到 wrangler.toml**

在 `wrangler.toml` 中添加：

```toml
# Queues 配置
[[queues.producers]]
binding = "PAPER_QUEUE"
queue = "paper-processing"

[[queues.consumers]]
queue = "paper-processing"
max_batch_size = 1
max_retries = 3
dead_letter_queue = "paper-processing-dlq"
```

**Step 2: 创建队列**

Run: `npx wrangler queues create paper-processing`
Expected: Queue 创建成功

Run: `npx wrangler queues create paper-processing-dlq`
Expected: Dead letter queue 创建成功

**Step 3: 提交**

```bash
git add wrangler.toml
git commit -m "feat: configure Cloudflare Queues for paper processing"
```

### Task 5.2: 修改 paper.create API 推送到队列

**Files:**
- Modify: `src/integrations/trpc/routers/paper.ts`

**Step 1: 更新 paper.create mutation**

在 `src/integrations/trpc/routers/paper.ts` 的 `create` mutation 中，事务完成后推送到队列：

```typescript
create: protectedProcedure
  .input(z.object({
    sourceType: z.enum(['upload', 'arxiv']),
    arxivUrl: z.string().optional(),
    filename: z.string(),
    fileSize: z.number(),
    r2Key: z.string().optional(), // arXiv 时为空
  }))
  .mutation(async ({ ctx, input }) => {
    const paper = await db.transaction(async (tx) => {
      // 现有的积分扣除和论文创建逻辑
      // ...
      return newPaper
    })

    // 推送到队列
    await ctx.env.PAPER_QUEUE.send({
      paperId: paper.id,
      userId: ctx.session.user.id,
      sourceType: input.sourceType,
      arxivUrl: input.arxivUrl,
      r2Key: input.r2Key,
    })

    return { paperId: paper.id, status: paper.status }
  }),
```

**Step 2: 更新 tRPC context 类型**

在 `src/integrations/trpc/init.ts` 中添加 PAPER_QUEUE 到 context：

```typescript
export const createContext = async (opts: FetchCreateContextFnOptions) => {
  return {
    headers: opts.req.headers,
    auth,
    env: opts.resHeaders.env, // 确保 env 包含 PAPER_QUEUE
  }
}
```

**Step 3: 提交**

```bash
git add src/integrations/trpc/routers/paper.ts src/integrations/trpc/init.ts
git commit -m "feat: push paper to queue after creation"
```

---

## Phase 6: PDF 处理服务

### Task 6.1: 安装 pdfjs-serverless

**Files:**
- Modify: `package.json`

**Step 1: 安装依赖**

Run: `npm install pdfjs-serverless`
Expected: 安装成功

**Step 2: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: install pdfjs-serverless"
```

### Task 6.2: 创建 PDF 处理工具函数

**Files:**
- Create: `src/lib/pdf.ts`

**Step 1: 创建 PDF 工具函数**

创建 `src/lib/pdf.ts`：

```typescript
import { getDocument } from 'pdfjs-serverless'

export interface PDFMetadata {
  pageCount: number
  text: string
}

export async function extractPDFText(pdfBuffer: ArrayBuffer): Promise<PDFMetadata> {
  try {
    const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise
    const pageCount = pdf.numPages

    const textPromises = []
    for (let i = 1; i <= pageCount; i++) {
      textPromises.push(
        pdf.getPage(i).then(page => page.getTextContent()).then(content =>
          content.items.map((item: any) => item.str).join(' ')
        )
      )
    }

    const pageTexts = await Promise.all(textPromises)
    const text = pageTexts.join('\n\n')

    return { pageCount, text }
  } catch (error) {
    throw new Error(`PDF extraction failed: ${error.message}`)
  }
}

export async function downloadArxivPDF(arxivUrl: string): Promise<ArrayBuffer> {
  // 从 arXiv URL 提取 ID
  const match = arxivUrl.match(/arxiv\.org\/(abs|pdf)\/(\d+\.\d+)/)
  if (!match) {
    throw new Error('Invalid arXiv URL')
  }

  const arxivId = match[2]
  const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`

  const response = await fetch(pdfUrl)
  if (!response.ok) {
    throw new Error(`Failed to download arXiv PDF: ${response.statusText}`)
  }

  return await response.arrayBuffer()
}
```

**Step 2: 提交**

```bash
git add src/lib/pdf.ts
git commit -m "feat: add PDF extraction utilities"
```

---

## Phase 7: AI 集成

### Task 7.1: 创建 AI 工具函数

**Files:**
- Create: `src/lib/ai.ts`

**Step 1: 创建 OpenAI 客户端封装**

创建 `src/lib/ai.ts`：

```typescript
export interface AIConfig {
  openaiApiKey: string
  openaiBaseUrl?: string
  openaiModel?: string
  geminiApiKey: string
  geminiBaseUrl?: string
  geminiModel?: string
}

export interface MindmapStructure {
  center: string
  branches: Array<{
    title: string
    nodes: string[]
  }>
}

export async function generateSummary(
  text: string,
  config: AIConfig
): Promise<string> {
  const baseUrl = config.openaiBaseUrl || 'https://api.openai.com/v1'
  const model = config.openaiModel || 'gpt-5-mini'

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是一个专业的学术论文分析助手。'
        },
        {
          role: 'user',
          content: `请阅读以下论文内容，生成一份简洁的总结（500-1000字）。

总结应包括：
1. 研究背景和动机
2. 主要方法和技术
3. 核心发现和结论
4. 研究意义和影响

论文内容：
${text}`
        }
      ],
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

export async function generateMindmapStructure(
  summary: string,
  config: AIConfig
): Promise<MindmapStructure> {
  const baseUrl = config.openaiBaseUrl || 'https://api.openai.com/v1'
  const model = config.openaiModel || 'gpt-5-mini'

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: `基于以下论文总结，生成一个思维导图的 JSON 结构。

要求：
- 中心主题：论文的核心主题
- 3-5 个主要分支：代表论文的主要部分
- 每个分支包含 2-4 个子节点：具体的要点

JSON 格式：
{
  "center": "中心主题",
  "branches": [
    {
      "title": "分支标题",
      "nodes": ["子节点1", "子节点2", "子节点3"]
    }
  ]
}

论文总结：
${summary}

请只返回 JSON，不要包含其他文字。`
        }
      ],
      temperature: 0.5,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} ${error}`)
  }

  const data = await response.json()
  const content = data.choices[0].message.content

  // 提取 JSON（可能包含 markdown 代码块）
  const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/) || content.match(/\{[\s\S]+\}/)
  if (!jsonMatch) {
    throw new Error('Failed to extract JSON from response')
  }

  return JSON.parse(jsonMatch[1] || jsonMatch[0])
}

export async function generateMindmapImage(
  structure: MindmapStructure,
  config: AIConfig
): Promise<ArrayBuffer> {
  const baseUrl = config.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'
  const model = config.geminiModel || 'gemini-3.1-flash-image-preview'

  const prompt = `生成一个清晰、美观的思维导图图片，基于以下结构：

${JSON.stringify(structure, null, 2)}

要求：
- 中心主题居中，使用较大字体
- 主要分支围绕中心放射状排列
- 子节点连接到对应的分支
- 使用不同颜色区分不同分支
- 整体布局清晰，易于阅读`

  const response = await fetch(`${baseUrl}/models/${model}:generateContent?key=${config.geminiApiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.4,
      }
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini API error: ${response.status} ${error}`)
  }

  const data = await response.json()

  // 提取图片数据（base64）
  const imageData = data.candidates[0].content.parts[0].inlineData
  if (!imageData) {
    throw new Error('No image data in response')
  }

  // 将 base64 转换为 ArrayBuffer
  const binaryString = atob(imageData.data)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return bytes.buffer
}
```

**Step 2: 提交**

```bash
git add src/lib/ai.ts
git commit -m "feat: add AI integration utilities for OpenAI and Gemini"
```

### Task 7.2: 更新环境变量示例

**Files:**
- Modify: `.dev.vars.example`

**Step 1: 添加 AI API 环境变量**

在 `.dev.vars.example` 中添加：

```
# AI API Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5-mini

GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_BASE_URL=
GEMINI_MODEL=gemini-3.1-flash-image-preview
```

**Step 2: 提交**

```bash
git add .dev.vars.example
git commit -m "docs: add AI API environment variables to example"
```

---

## Phase 8: Queue Consumer Worker

### Task 8.1: 创建 Queue Consumer

**Files:**
- Create: `src/workers/queue-consumer.ts`

**Step 1: 创建 queue consumer 基础结构**

创建 `src/workers/queue-consumer.ts`（前 50 行）：

```typescript
import { db } from '#/db'
import { papers, paperResults } from '#/db/schema'
import { eq } from 'drizzle-orm'
import { extractPDFText, downloadArxivPDF } from '#/lib/pdf'
import { generateSummary, generateMindmapStructure, generateMindmapImage } from '#/lib/ai'
import type { AIConfig } from '#/lib/ai'

interface QueueMessage {
  paperId: string
  userId: string
  sourceType: 'upload' | 'arxiv'
  arxivUrl?: string
  r2Key?: string
}

interface Env {
  PAPERS_BUCKET: R2Bucket
  OPENAI_API_KEY: string
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  GEMINI_API_KEY: string
  GEMINI_BASE_URL?: string
  GEMINI_MODEL?: string
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processPaper(message.body, env)
        message.ack()
      } catch (error) {
        console.error(`Failed to process paper ${message.body.paperId}:`, error)

        // 判断是否可重试
        if (isRetryableError(error)) {
          message.retry()
        } else {
          // 标记为 failed
          await markPaperFailed(message.body.paperId, error.message)
          message.ack()
        }
      }
    }
  }
}

async function processPaper(msg: QueueMessage, env: Env): Promise<void> {
```

**Step 2: 继续编写 processPaper 函数**

在 `src/workers/queue-consumer.ts` 中继续添加：

```typescript
  // Step 1: 获取 PDF
  let pdfBuffer: ArrayBuffer
  let r2Key = msg.r2Key

  if (msg.sourceType === 'arxiv') {
    // 下载 arXiv PDF
    await updatePaperStatus(msg.paperId, 'processing_text', null)
    pdfBuffer = await downloadArxivPDF(msg.arxivUrl!)

    // 上传到 R2
    r2Key = `papers/${msg.userId}/${Date.now()}-arxiv-${msg.paperId}.pdf`
    await env.PAPERS_BUCKET.put(r2Key, pdfBuffer)

    // 更新数据库中的 r2Key
    await db.update(papers)
      .set({ pdfR2Key: r2Key })
      .where(eq(papers.id, msg.paperId))
  } else {
    // 从 R2 读取上传的 PDF
    const object = await env.PAPERS_BUCKET.get(r2Key!)
    if (!object) {
      throw new Error('PDF file not found in R2')
    }
    pdfBuffer = await object.arrayBuffer()
  }

  // Step 2: 提取文本
  await updatePaperStatus(msg.paperId, 'processing_text', null)
  const { pageCount, text } = await extractPDFText(pdfBuffer)

  // 更新页数
  await db.update(papers)
    .set({ pageCount })
    .where(eq(papers.id, msg.paperId))

  // Step 3: 生成总结和思维导图结构
  const aiConfig: AIConfig = {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL,
    openaiModel: env.OPENAI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiBaseUrl: env.GEMINI_BASE_URL,
    geminiModel: env.GEMINI_MODEL,
  }

  const summary = await generateSummary(text, aiConfig)
  const mindmapStructure = await generateMindmapStructure(summary, aiConfig)

  // Step 4: 生成思维导图图片
  await updatePaperStatus(msg.paperId, 'processing_image', null)
  const imageBuffer = await generateMindmapImage(mindmapStructure, aiConfig)

  // 上传图片到 R2
  const imageR2Key = `mindmaps/${msg.userId}/${msg.paperId}.png`
  await env.PAPERS_BUCKET.put(imageR2Key, imageBuffer, {
    httpMetadata: { contentType: 'image/png' }
  })

  // Step 5: 保存结果
  await db.insert(paperResults).values({
    paperId: msg.paperId,
    summary,
    mindmapStructure: JSON.stringify(mindmapStructure),
    mindmapImageR2Key: imageR2Key,
    imagePrompt: '', // 可选：保存生成图片的 prompt
    processingTimeMs: 0, // 可选：记录处理时间
  })

  // Step 6: 标记完成
  await updatePaperStatus(msg.paperId, 'completed', null)
}

async function updatePaperStatus(
  paperId: string,
  status: string,
  errorMessage: string | null
): Promise<void> {
  await db.update(papers)
    .set({
      status,
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(papers.id, paperId))
}

async function markPaperFailed(paperId: string, errorMessage: string): Promise<void> {
  await updatePaperStatus(paperId, 'failed', errorMessage)
}

function isRetryableError(error: any): boolean {
  const message = error.message || ''

  // 网络超时
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return true
  }

  // API 限流
  if (message.includes('429') || message.includes('rate limit')) {
    return true
  }

  // 临时服务错误
  if (message.includes('500') || message.includes('502') || message.includes('503')) {
    return true
  }

  return false
}
```

**Step 3: 配置 wrangler.toml 添加 consumer**

在 `wrangler.toml` 中添加 consumer 配置：

```toml
# Queue Consumer Worker
name = "picx-queue-consumer"
main = "src/workers/queue-consumer.ts"
compatibility_date = "2024-01-01"

[[queues.consumers]]
queue = "paper-processing"
max_batch_size = 1
max_retries = 3
dead_letter_queue = "paper-processing-dlq"

[[r2_buckets]]
binding = "PAPERS_BUCKET"
bucket_name = "picx-papers"
```

**Step 4: 提交**

```bash
git add src/workers/queue-consumer.ts wrangler.toml
git commit -m "feat: implement queue consumer for paper processing"
```

---

## Phase 9: Durable Objects + SSE

### Task 9.1: 创建 Durable Object

**Files:**
- Create: `src/workers/paper-status-do.ts`

**Step 1: 创建 PaperStatusDO 类**

创建 `src/workers/paper-status-do.ts`：

```typescript
interface Connection {
  id: string
  controller: ReadableStreamDefaultController
  lastPing: number
}

export class PaperStatusDO {
  private connections: Map<string, Connection> = new Map()
  private heartbeatInterval: number | null = null

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/connect' && request.method === 'GET') {
      return this.handleConnect(request)
    }

    if (url.pathname === '/notify' && request.method === 'POST') {
      return this.handleNotify(request)
    }

    return new Response('Not found', { status: 404 })
  }

  private async handleConnect(request: Request): Promise<Response> {
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    const connectionId = crypto.randomUUID()

    // 发送连接成功消息
    await writer.write(encoder.encode('data: {"type":"connected"}\n\n'))

    // 保存连接
    const stream = readable.getReader()
    this.connections.set(connectionId, {
      id: connectionId,
      controller: writer as any,
      lastPing: Date.now(),
    })

    // 启动心跳
    if (!this.heartbeatInterval) {
      this.startHeartbeat()
    }

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  private async handleNotify(request: Request): Promise<Response> {
    const data = await request.json()

    // 广播到所有连接
    await this.broadcast({
      paperId: data.paperId,
      status: data.status,
      progress: data.progress,
      errorMessage: data.errorMessage,
    })

    return new Response('OK')
  }

  private async broadcast(data: any): Promise<void> {
    const encoder = new TextEncoder()
    const message = `event: paper-update\ndata: ${JSON.stringify(data)}\n\n`

    const deadConnections: string[] = []

    for (const [id, conn] of this.connections) {
      try {
        await conn.controller.write(encoder.encode(message))
      } catch (error) {
        deadConnections.push(id)
      }
    }

    // 清理断开的连接
    for (const id of deadConnections) {
      this.connections.delete(id)
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, 30000) as any
  }

  private async sendHeartbeat(): Promise<void> {
    const encoder = new TextEncoder()
    const ping = encoder.encode(': ping\n\n')

    const deadConnections: string[] = []

    for (const [id, conn] of this.connections) {
      try {
        await conn.controller.write(ping)
        conn.lastPing = Date.now()
      } catch (error) {
        deadConnections.push(id)
      }
    }

    // 清理断开的连接
    for (const id of deadConnections) {
      this.connections.delete(id)
    }

    // 如果没有连接了，停止心跳
    if (this.connections.size === 0 && this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }
}
```

**Step 2: 配置 wrangler.toml**

在 `wrangler.toml` 中添加 DO 配置：

```toml
[[durable_objects.bindings]]
name = "PAPER_STATUS_DO"
class_name = "PaperStatusDO"
script_name = "picx"

[[migrations]]
tag = "v1"
new_classes = ["PaperStatusDO"]
```

**Step 3: 提交**

```bash
git add src/workers/paper-status-do.ts wrangler.toml
git commit -m "feat: implement Durable Object for SSE connections"
```

### Task 9.2: 创建 SSE API 端点

**Files:**
- Create: `src/integrations/trpc/routers/sse.ts`

**Step 1: 创建 SSE 路由**

创建 `src/integrations/trpc/routers/sse.ts`：

```typescript
import { router, protectedProcedure } from '../init'

export const sseRouter = router({
  connect: protectedProcedure.query(async ({ ctx }) => {
    const doId = ctx.env.PAPER_STATUS_DO.idFromName(ctx.session.user.id)
    const stub = ctx.env.PAPER_STATUS_DO.get(doId)

    return stub.fetch(new Request('https://do/connect'))
  }),
})
```

**Step 2: 注册路由**

在 `src/integrations/trpc/router.ts` 中添加：

```typescript
import { sseRouter } from './routers/sse'

export const appRouter = router({
  user: userRouter,
  paper: paperRouter,
  upload: uploadRouter,
  sse: sseRouter,
})
```

**Step 3: 提交**

```bash
git add src/integrations/trpc/routers/sse.ts src/integrations/trpc/router.ts
git commit -m "feat: add SSE tRPC router"
```

### Task 9.3: 更新 Queue Consumer 推送 SSE

**Files:**
- Modify: `src/workers/queue-consumer.ts`

**Step 1: 添加 SSE 通知函数**

在 `src/workers/queue-consumer.ts` 中添加：

```typescript
async function notifySSE(
  env: Env,
  userId: string,
  paperId: string,
  status: string,
  progress: number
): Promise<void> {
  try {
    const doId = env.PAPER_STATUS_DO.idFromName(userId)
    const stub = env.PAPER_STATUS_DO.get(doId)

    await stub.fetch(new Request('https://do/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperId, status, progress, errorMessage: null }),
    }))
  } catch (error) {
    console.error('Failed to notify SSE:', error)
  }
}
```

**Step 2: 在 processPaper 中调用通知**

更新 `processPaper` 函数，在每个状态更新后调用 `notifySSE`：

```typescript
// 在状态更新后添加
await updatePaperStatus(msg.paperId, 'processing_text', null)
await notifySSE(env, msg.userId, msg.paperId, 'processing_text', 33)

// ...

await updatePaperStatus(msg.paperId, 'processing_image', null)
await notifySSE(env, msg.userId, msg.paperId, 'processing_image', 66)

// ...

await updatePaperStatus(msg.paperId, 'completed', null)
await notifySSE(env, msg.userId, msg.paperId, 'completed', 100)
```

**Step 3: 提交**

```bash
git add src/workers/queue-consumer.ts
git commit -m "feat: integrate SSE notifications in queue consumer"
```

---

## Phase 10: 前端页面

由于前端页面内容较多，这里提供关键任务的概要。详细实现请参考设计文档。

### Task 10.1: 创建论文列表页

**Files:**
- Create: `src/routes/papers/index.tsx`
- Create: `src/components/papers/paper-list.tsx`
- Create: `src/components/papers/upload-dialog.tsx`

**实现要点：**
- 使用 `paper.list` tRPC query 获取论文列表
- 实现分页和状态筛选
- 集成 SSE 实时更新
- 使用 shadcn/ui Card、Badge、Button 组件

### Task 10.2: 创建论文详情页

**Files:**
- Create: `src/routes/papers/$paperId.tsx`
- Create: `src/components/papers/paper-detail.tsx`

**实现要点：**
- 使用 `paper.getById` tRPC query 获取详情
- 显示处理进度（Progress 组件）
- 显示总结和思维导图图片
- 实现 PDF 下载和删除功能

### Task 10.3: 创建积分历史页

**Files:**
- Create: `src/routes/credits/index.tsx`
- Create: `src/components/credits/credit-history.tsx`

**实现要点：**
- 使用 `user.getCreditHistory` tRPC query 获取历史
- 使用 shadcn/ui Table 组件
- 实现分页

---

## Phase 11: 国际化

### Task 11.1: 配置 Paraglide

**Files:**
- Create: `messages/zh-CN.json`
- Create: `messages/en.json`
- Modify: `package.json`

**Step 1: 安装 Paraglide**

Run: `npm install @inlang/paraglide-js`
Expected: 安装成功

**Step 2: 创建翻译文件**

创建 `messages/zh-CN.json`：

```json
{
  "papers.title": "论文列表",
  "papers.upload": "上传论文",
  "papers.status.pending": "等待处理",
  "papers.status.processing_text": "提取文本中",
  "papers.status.processing_image": "生成图片中",
  "papers.status.completed": "已完成",
  "papers.status.failed": "处理失败",
  "credits.title": "积分历史",
  "credits.balance": "当前积分",
  "upload.file.title": "上传文件",
  "upload.arxiv.title": "arXiv 链接",
  "error.insufficient_credits": "积分不足",
  "error.file_too_large": "文件过大",
  "error.invalid_arxiv_url": "无效的 arXiv 链接"
}
```

创建 `messages/en.json`：

```json
{
  "papers.title": "Papers",
  "papers.upload": "Upload Paper",
  "papers.status.pending": "Pending",
  "papers.status.processing_text": "Extracting Text",
  "papers.status.processing_image": "Generating Image",
  "papers.status.completed": "Completed",
  "papers.status.failed": "Failed",
  "credits.title": "Credit History",
  "credits.balance": "Current Balance",
  "upload.file.title": "Upload File",
  "upload.arxiv.title": "arXiv Link",
  "error.insufficient_credits": "Insufficient credits",
  "error.file_too_large": "File too large",
  "error.invalid_arxiv_url": "Invalid arXiv URL"
}
```

**Step 3: 提交**

```bash
git add messages/ package.json package-lock.json
git commit -m "feat: configure Paraglide i18n with zh-CN and en"
```

---

## 执行建议

1. **按阶段执行**：完成一个 Phase 后再进入下一个
2. **频繁提交**：每完成一个 Task 就提交
3. **测试驱动**：关键功能先写测试
4. **保持简单**：遵循 YAGNI 原则

---

## 总结

本实施计划涵盖 Phase 5-10 的所有关键任务：

- **Phase 5**: Cloudflare Queues 配置
- **Phase 6**: PDF 处理服务（pdfjs-serverless）
- **Phase 7**: AI 集成（OpenAI + Gemini）
- **Phase 8**: Queue Consumer Worker
- **Phase 9**: Durable Objects + SSE
- **Phase 10**: 前端页面（列表、详情、积分历史）
- **Phase 11**: 国际化（Paraglide）

每个任务都包含详细的步骤、代码示例和提交命令。
