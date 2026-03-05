# 论文总结与思维导图生成系统 - 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个 serverless 论文处理系统，用户上传 PDF 或 arXiv 链接，系统自动生成论文总结和思维导图图片

**Architecture:** 基于 Cloudflare Workers + D1 + R2 + Queues 的全栈应用，使用 TanStack Start 框架，通过异步队列处理 PDF 和 AI 调用，SSE 实时推送状态更新

**Tech Stack:** TanStack Start, Cloudflare D1/R2/Queues, Drizzle ORM, Better Auth, tRPC, OpenAI API, Gemini API, shadcn/ui

---

## 实施概览

本计划分为 10 个阶段，每个阶段包含多个小任务：

1. **数据库 Schema 设计** - 扩展 Drizzle schema，添加 papers、paper_results、credit_transactions 表
2. **用户系统扩展** - 为 Better Auth 用户添加积分字段和初始化逻辑
3. **R2 文件上传** - 实现预签名 URL 上传和文件管理
4. **tRPC API 路由** - 创建用户、论文、上传相关的 API
5. **Cloudflare Queues 配置** - 配置队列和消费者
6. **PDF 处理服务** - 集成 PDF 解析和文本提取
7. **AI 集成** - 接入 OpenAI 和 Gemini API
8. **SSE 实时更新** - 使用 Durable Objects 实现状态推送
9. **前端页面** - 实现论文列表、详情、积分历史页
10. **国际化和测试** - 添加中英文翻译，端到端测试

---

## Phase 1: 数据库 Schema 设计

### Task 1.1: 扩展数据库 Schema

**Files:**
- Modify: `src/db/schema.ts`

**Step 1: 添加新表定义到 schema**

在 `src/db/schema.ts` 中，保留现有的 `todos` 表，添加新表：

```typescript
import { pgTable, text, timestamp, integer, index } from 'drizzle-orm/pg-core'

// 现有的 todos 表保持不变

// 论文表
export const papers = pgTable('papers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  sourceType: text('source_type', { enum: ['upload', 'arxiv'] }).notNull(),
  sourceUrl: text('source_url'),
  pdfR2Key: text('pdf_r2_key').notNull(),
  fileSize: integer('file_size').notNull(),
  pageCount: integer('page_count'),
  status: text('status', {
    enum: ['pending', 'processing_text', 'processing_image', 'completed', 'failed']
  }).notNull().default('pending'),
  errorMessage: text('error_message'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('papers_user_id_idx').on(table.userId, table.deletedAt, table.createdAt),
  statusIdx: index('papers_status_idx').on(table.status, table.deletedAt),
}))

// 论文结果表
export const paperResults = pgTable('paper_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  paperId: text('paper_id').notNull().references(() => papers.id),
  summary: text('summary').notNull(),
  mindmapStructure: text('mindmap_structure').notNull(), // JSON string
  mindmapImageR2Key: text('mindmap_image_r2_key'),
  imagePrompt: text('image_prompt').notNull(),
  processingTimeMs: integer('processing_time_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// 积分交易表
export const creditTransactions = pgTable('credit_transactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  amount: integer('amount').notNull(),
  type: text('type', { enum: ['initial', 'consume', 'refund', 'purchase'] }).notNull(),
  relatedPaperId: text('related_paper_id').references(() => papers.id),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('credit_transactions_user_id_idx').on(table.userId, table.createdAt),
}))

// 用户表扩展（Better Auth 会创建基础表，我们添加 credits 字段）
// 注意：这需要在 Better Auth 配置中处理
```

**Step 2: 生成迁移文件**

Run: `npm run db:generate`
Expected: 生成新的迁移文件在 `drizzle/` 目录

**Step 3: 应用迁移到本地数据库**

Run: `npm run db:push`
Expected: 表创建成功

**Step 4: 提交**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add papers, paper_results, credit_transactions schema"
```

---

## Phase 2: 用户系统扩展

### Task 2.1: 扩展 Better Auth 用户表

**Files:**
- Modify: `src/lib/auth.ts`
- Create: `src/db/user-extensions.ts`

**Step 1: 配置 Better Auth 添加 credits 字段**

在 `src/lib/auth.ts` 中修改 Better Auth 配置：

```typescript
import { betterAuth } from "better-auth"

export const auth = betterAuth({
  database: {
    // 现有配置
  },
  user: {
    additionalFields: {
      credits: {
        type: "number",
        defaultValue: 10,
        required: true,
      },
    },
  },
  // 其他配置保持不变
})
```

**Step 2: 创建用户注册钩子**

创建 `src/db/user-extensions.ts`：

```typescript
import { db } from './index'
import { creditTransactions } from './schema'

export async function initializeUserCredits(userId: string) {
  await db.insert(creditTransactions).values({
    userId,
    amount: 10,
    type: 'initial',
    description: '注册赠送',
  })
}
```

**Step 3: 在 auth 配置中添加注册后钩子**

在 `src/lib/auth.ts` 中添加：

```typescript
export const auth = betterAuth({
  // 现有配置
  hooks: {
    after: [
      {
        matcher: (context) => context.path === '/sign-up',
        handler: async (context) => {
          if (context.user) {
            await initializeUserCredits(context.user.id)
          }
        },
      },
    ],
  },
})
```

**Step 4: 运行迁移更新用户表**

Run: `npm run db:push`
Expected: 用户表添加 credits 字段

**Step 5: 提交**

```bash
git add src/lib/auth.ts src/db/user-extensions.ts
git commit -m "feat: add credits field to user and initialize on signup"
```

---

## Phase 3: R2 文件上传

### Task 3.1: 配置 Cloudflare R2 绑定

**Files:**
- Modify: `wrangler.toml`
- Create: `src/lib/r2.ts`

**Step 1: 在 wrangler.toml 中添加 R2 绑定**

```toml
[[r2_buckets]]
binding = "PAPERS_BUCKET"
bucket_name = "picx-papers"
preview_bucket_name = "picx-papers-preview"
```

**Step 2: 创建 R2 bucket**

Run: `npx wrangler r2 bucket create picx-papers`
Expected: Bucket 创建成功

Run: `npx wrangler r2 bucket create picx-papers-preview`
Expected: Preview bucket 创建成功

**Step 3: 创建 R2 工具函数**

创建 `src/lib/r2.ts`：

```typescript
export interface R2Env {
  PAPERS_BUCKET: R2Bucket
}

export async function generatePresignedUploadUrl(
  bucket: R2Bucket,
  key: string,
  expiresIn = 3600
): Promise<string> {
  // Cloudflare R2 预签名 URL 生成
  // 注意：需要配置 R2 的 CORS 和访问策略
  const url = await bucket.createMultipartUpload(key)
  return url
}

export async function getFileUrl(
  bucket: R2Bucket,
  key: string,
  expiresIn = 3600
): Promise<string> {
  // 生成临时访问 URL
  const object = await bucket.get(key)
  if (!object) throw new Error('File not found')

  // 返回公开 URL 或预签名 URL
  return `https://your-r2-domain/${key}`
}

export async function deleteFile(
  bucket: R2Bucket,
  key: string
): Promise<void> {
  await bucket.delete(key)
}
```

**Step 4: 提交**

```bash
git add wrangler.toml src/lib/r2.ts
git commit -m "feat: configure R2 bucket and utility functions"
```

---

## Phase 4: tRPC API 路由

### Task 4.1: 创建用户相关 API

**Files:**
- Create: `src/integrations/trpc/routers/user.ts`
- Modify: `src/integrations/trpc/router.ts`

**Step 1: 创建用户路由**

创建 `src/integrations/trpc/routers/user.ts`：

```typescript
import { z } from 'zod'
import { publicProcedure, router } from '../init'
import { db } from '#/db'
import { creditTransactions } from '#/db/schema'
import { eq, desc } from 'drizzle-orm'

export const userRouter = router({
  getProfile: publicProcedure.query(async ({ ctx }) => {
    // 从 Better Auth session 获取用户
    const session = await ctx.auth.api.getSession({ headers: ctx.headers })
    if (!session) throw new Error('Unauthorized')

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      credits: session.user.credits,
    }
  }),

  getCreditHistory: publicProcedure
    .input(z.object({
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.auth.api.getSession({ headers: ctx.headers })
      if (!session) throw new Error('Unauthorized')

      const offset = (input.page - 1) * input.limit

      const transactions = await db
        .select()
        .from(creditTransactions)
        .where(eq(creditTransactions.userId, session.user.id))
        .orderBy(desc(creditTransactions.createdAt))
        .limit(input.limit)
        .offset(offset)

      const total = await db
        .select({ count: sql<number>`count(*)` })
        .from(creditTransactions)
        .where(eq(creditTransactions.userId, session.user.id))

      return {
        transactions,
        total: total[0].count,
      }
    }),
})
```

**Step 2: 注册路由到主 router**

在 `src/integrations/trpc/router.ts` 中：

```typescript
import { userRouter } from './routers/user'

export const appRouter = router({
  // 现有路由
  user: userRouter,
})
```

**Step 3: 提交**

```bash
git add src/integrations/trpc/routers/user.ts src/integrations/trpc/router.ts
git commit -m "feat: add user tRPC router with profile and credit history"
```

### Task 4.2: 创建论文相关 API

**Files:**
- Create: `src/integrations/trpc/routers/paper.ts`

**Step 1: 创建论文路由**

创建 `src/integrations/trpc/routers/paper.ts`：

```typescript
import { z } from 'zod'
import { publicProcedure, router } from '../init'
import { db } from '#/db'
import { papers, paperResults, creditTransactions } from '#/db/schema'
import { eq, and, isNull, desc, sql } from 'drizzle-orm'

export const paperRouter = router({
  create: publicProcedure
    .input(z.object({
      sourceType: z.enum(['upload', 'arxiv']),
      arxivUrl: z.string().optional(),
      filename: z.string(),
      fileSize: z.number(),
      r2Key: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.auth.api.getSession({ headers: ctx.headers })
      if (!session) throw new Error('Unauthorized')

      // 检查积分
      if (session.user.credits < 10) {
        throw new Error('Insufficient credits')
      }

      // 使用事务：创建论文记录 + 扣除积分
      const paper = await db.transaction(async (tx) => {
        // 创建论文记录
        const [newPaper] = await tx.insert(papers).values({
          userId: session.user.id,
          title: input.filename,
          sourceType: input.sourceType,
          sourceUrl: input.arxivUrl,
          pdfR2Key: input.r2Key,
          fileSize: input.fileSize,
          status: 'pending',
        }).returning()

        // 扣除积分
        await tx.update(users).set({
          credits: sql`${users.credits} - 10`,
        }).where(eq(users.id, session.user.id))

        // 记录积分交易
        await tx.insert(creditTransactions).values({
          userId: session.user.id,
          amount: -10,
          type: 'consume',
          relatedPaperId: newPaper.id,
          description: '处理论文',
        })

        return newPaper
      })

      // TODO: 推送到队列

      return { paperId: paper.id, status: paper.status }
    }),

  list: publicProcedure
    .input(z.object({
      page: z.number().default(1),
      limit: z.number().default(20),
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.auth.api.getSession({ headers: ctx.headers })
      if (!session) throw new Error('Unauthorized')

      const offset = (input.page - 1) * input.limit

      const conditions = [
        eq(papers.userId, session.user.id),
        isNull(papers.deletedAt),
      ]

      if (input.status) {
        conditions.push(eq(papers.status, input.status))
      }

      const paperList = await db
        .select()
        .from(papers)
        .where(and(...conditions))
        .orderBy(desc(papers.createdAt))
        .limit(input.limit)
        .offset(offset)

      const total = await db
        .select({ count: sql<number>`count(*)` })
        .from(papers)
        .where(and(...conditions))

      return {
        papers: paperList,
        total: total[0].count,
      }
    }),

  getById: publicProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const session = await ctx.auth.api.getSession({ headers: ctx.headers })
      if (!session) throw new Error('Unauthorized')

      const paper = await db
        .select()
        .from(papers)
        .where(and(
          eq(papers.id, input),
          eq(papers.userId, session.user.id),
          isNull(papers.deletedAt)
        ))
        .limit(1)

      if (!paper[0]) throw new Error('Paper not found')

      // 获取结果（如果有）
      const result = await db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input))
        .limit(1)

      return {
        paper: paper[0],
        result: result[0] || null,
      }
    }),

  delete: publicProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.auth.api.getSession({ headers: ctx.headers })
      if (!session) throw new Error('Unauthorized')

      await db
        .update(papers)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(papers.id, input),
          eq(papers.userId, session.user.id)
        ))

      return { success: true }
    }),
})
```

**Step 2: 注册路由**

在 `src/integrations/trpc/router.ts` 中添加：

```typescript
import { paperRouter } from './routers/paper'

export const appRouter = router({
  user: userRouter,
  paper: paperRouter,
})
```

**Step 3: 提交**

```bash
git add src/integrations/trpc/routers/paper.ts src/integrations/trpc/router.ts
git commit -m "feat: add paper tRPC router with CRUD operations"
```

### Task 4.3: 创建文件上传 API

**Files:**
- Create: `src/integrations/trpc/routers/upload.ts`

**Step 1: 创建上传路由**

创建 `src/integrations/trpc/routers/upload.ts`：

```typescript
import { z } from 'zod'
import { publicProcedure, router } from '../init'
import { generatePresignedUploadUrl } from '#/lib/r2'

export const uploadRouter = router({
  getPresignedUrl: publicProcedure
    .input(z.object({
      filename: z.string(),
      contentType: z.string(),
      fileSize: z.number().max(50 * 1024 * 1024), // 50MB
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.auth.api.getSession({ headers: ctx.headers })
      if (!session) throw new Error('Unauthorized')

      // 验证文件类型
      if (input.contentType !== 'application/pdf') {
        throw new Error('Only PDF files are allowed')
      }

      // 生成唯一的 R2 key
      const r2Key = `papers/${session.user.id}/${Date.now()}-${input.filename}`

      // 生成预签名 URL
      const uploadUrl = await generatePresignedUploadUrl(
        ctx.env.PAPERS_BUCKET,
        r2Key
      )

      return {
        uploadUrl,
        r2Key,
      }
    }),
})
```

**Step 2: 注册路由**

在 `src/integrations/trpc/router.ts` 中添加：

```typescript
import { uploadRouter } from './routers/upload'

export const appRouter = router({
  user: userRouter,
  paper: paperRouter,
  upload: uploadRouter,
})
```

**Step 3: 提交**

```bash
git add src/integrations/trpc/routers/upload.ts src/integrations/trpc/router.ts
git commit -m "feat: add upload tRPC router for presigned URLs"
```

---

## Phase 5-10: 后续阶段

由于篇幅限制，后续阶段（Cloudflare Queues、PDF 处理、AI 集成、SSE、前端页面、国际化）的详细步骤将在执行时逐步展开。

关键任务包括：

**Phase 5: Cloudflare Queues**
- 配置 wrangler.toml 中的 queues
- 创建 queue consumer workers
- 实现任务推送和消费逻辑

**Phase 6: PDF 处理**
- 集成 pdf-parse 或 pdfjs-dist
- 实现文本提取
- 处理 arXiv 链接下载

**Phase 7: AI 集成**
- 接入 OpenAI API（论文总结 + 思维导图结构）
- 接入 Gemini API（图片生成）
- 实现重试和错误处理

**Phase 8: SSE 实时更新**
- 使用 Durable Objects 维护连接
- 实现状态推送机制
- 前端 SSE 客户端

**Phase 9: 前端页面**
- 论文列表页（/papers）
- 论文详情页（/papers/:id）
- 积分历史页（/credits）
- 使用 shadcn/ui 组件

**Phase 10: 国际化和测试**
- 配置 Paraglide
- 添加中英文翻译
- 编写端到端测试
- 部署到 Cloudflare Workers

---

## 执行建议

1. **按阶段执行**：完成一个阶段后再进入下一个
2. **频繁提交**：每完成一个小任务就提交
3. **测试驱动**：先写测试，再写实现
4. **保持简单**：遵循 YAGNI 原则，不过度设计

