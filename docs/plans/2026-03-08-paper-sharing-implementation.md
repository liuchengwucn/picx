# 论文分享系统实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现论文分享系统，允许用户将生成的论文总结公开到画廊，供所有人浏览

**Architecture:** 在 papers 表添加 isPublic 和 publishedAt 字段，新增 tRPC 路由处理分享逻辑，创建公开画廊页面展示公开论文，使用图片卡片布局

**Tech Stack:** Drizzle ORM, tRPC, TanStack Router, React, Tailwind CSS, Paraglide i18n

---

## Task 1: 数据库迁移

**Files:**
- Create: `drizzle/0005_add_paper_sharing.sql`
- Modify: `src/db/schema.ts:72-115`

**Step 1: 创建数据库迁移文件**

创建 `drizzle/0005_add_paper_sharing.sql`:

```sql
-- Add sharing fields to papers table
ALTER TABLE papers ADD COLUMN is_public INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE papers ADD COLUMN published_at INTEGER;

-- Create index for public papers query
CREATE INDEX papers_public_idx ON papers(is_public, published_at);
```

**Step 2: 更新 schema.ts**

在 `src/db/schema.ts` 的 papers 表定义中添加新字段（第 72-115 行）:

```typescript
export const papers = sqliteTable(
  "papers",
  {
    // ... 现有字段
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    publishedAt: integer("published_at", { mode: "timestamp" }),
  },
  (table) => ({
    // ... 现有索引
    publicIdx: index("papers_public_idx").on(
      table.isPublic,
      table.publishedAt,
    ),
  }),
);
```

**Step 3: 运行迁移**

```bash
npm run db:migrate
```

预期：迁移成功，字段和索引已添加

**Step 4: 提交**

```bash
git add drizzle/0005_add_paper_sharing.sql src/db/schema.ts
git commit -m "feat: add paper sharing database schema"
```

---

## Task 2: 后端 API - togglePublic

**Files:**
- Modify: `src/integrations/trpc/routers/paper.ts:403`

**Step 1: 添加 togglePublic 路由**

在 `src/integrations/trpc/routers/paper.ts` 文件末尾（第 403 行后）添加:

```typescript
  /**
   * Toggle paper public status
   * Only owner can toggle, and paper must be completed with whiteboard
   */
  togglePublic: protectedProcedure
    .input(z.object({ paperId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      // Check if paper exists and belongs to user
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Check if paper is completed
      if (paper.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must be completed before sharing",
        });
      }

      // Check if whiteboard image exists
      const [result] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input.paperId))
        .limit(1);

      if (!result?.whiteboardImageR2Key) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must have whiteboard image before sharing",
        });
      }

      // Toggle public status
      const newIsPublic = !paper.isPublic;
      const [updatedPaper] = await ctx.db
        .update(papers)
        .set({
          isPublic: newIsPublic,
          publishedAt: newIsPublic ? new Date() : null,
        })
        .where(eq(papers.id, input.paperId))
        .returning();

      return {
        success: true,
        isPublic: updatedPaper.isPublic,
      };
    }),
```

**Step 2: 提交**

```bash
git add src/integrations/trpc/routers/paper.ts
git commit -m "feat: add togglePublic API endpoint"
```

---

## Task 3: 后端 API - listPublic

**Files:**
- Modify: `src/integrations/trpc/routers/paper.ts`

**Step 1: 添加 listPublic 路由**

在 togglePublic 后添加:

```typescript
  /**
   * List public papers for gallery
   * Accessible by everyone (no auth required)
   */
  listPublic: publicProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.limit;

      // Query public papers with results
      const publicPapers = await ctx.db
        .select({
          id: papers.id,
          title: papers.title,
          publishedAt: papers.publishedAt,
          whiteboardImageR2Key: paperResults.whiteboardImageR2Key,
        })
        .from(papers)
        .innerJoin(paperResults, eq(papers.id, paperResults.paperId))
        .where(
          and(
            eq(papers.isPublic, true),
            eq(papers.status, "completed"),
            isNull(papers.deletedAt),
          ),
        )
        .orderBy(desc(papers.publishedAt))
        .limit(input.limit)
        .offset(offset);

      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(papers)
        .where(
          and(
            eq(papers.isPublic, true),
            eq(papers.status, "completed"),
            isNull(papers.deletedAt),
          ),
        );

      return {
        papers: publicPapers,
        total: totalResult.count,
      };
    }),
```

**Step 2: 导入 publicProcedure**

在文件顶部的导入语句中添加 `publicProcedure`:

```typescript
import { protectedProcedure, publicProcedure, router } from "../init";
```

**Step 3: 提交**

```bash
git add src/integrations/trpc/routers/paper.ts
git commit -m "feat: add listPublic API endpoint"
```

---

## Task 4: 后端 API - 修改 getById 权限

**Files:**
- Modify: `src/integrations/trpc/routers/paper.ts:201-250`

**Step 1: 修改 getById 权限检查**

将 `getById` 路由的查询逻辑修改为:

```typescript
  getById: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Check permission: owner or public paper
      if (paper.userId !== ctx.session.user.id && !paper.isPublic) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to view this paper",
        });
      }

      // 获取结果（如果有）
      const [result] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input))
        .limit(1);

      // 如果有结果，返回当前语言的摘要
      if (result) {
        const summaries = result.summaries as Record<string, string>;
        const currentLanguage = result.summaryLanguage;
        const summary = summaries[currentLanguage] || summaries.en || "";

        return {
          paper,
          result: {
            ...result,
            summary,
            availableLanguages: Object.keys(summaries),
          },
        };
      }

      return {
        paper,
        result: null,
      };
    }),
```

**Step 2: 提交**

```bash
git add src/integrations/trpc/routers/paper.ts
git commit -m "feat: allow public papers to be viewed by anyone"
```

---

## Task 5: 国际化翻译

**Files:**
- Modify: `messages/zh-CN.json`
- Modify: `messages/zh-TW.json`
- Modify: `messages/en.json`
- Modify: `messages/ja.json`

**Step 1: 添加简体中文翻译**

在 `messages/zh-CN.json` 添加:

```json
  "paper_share_to_gallery": "分享到公开画廊",
  "paper_share_description": "让更多人看到你的论文总结",
  "paper_share_button": "分享到画廊",
  "paper_share_requirement": "需要完成处理并生成白板图才能分享",
  "paper_shared_notice": "此论文已公开分享",
  "paper_share_link": "分享链接",
  "paper_copy_link": "复制链接",
  "paper_link_copied": "链接已复制",
  "paper_unshare": "取消公开",
  "paper_public_badge": "公开分享",
  "explore_title": "公开画廊",
  "explore_description": "探索其他用户分享的论文总结",
  "explore_empty_title": "暂无公开的论文",
  "explore_empty_description": "成为第一个分享论文总结的用户吧！",
  "nav_explore": "画廊"
```

**Step 2: 添加繁体中文翻译**

在 `messages/zh-TW.json` 添加:

```json
  "paper_share_to_gallery": "分享到公開畫廊",
  "paper_share_description": "讓更多人看到你的論文總結",
  "paper_share_button": "分享到畫廊",
  "paper_share_requirement": "需要完成處理並生成白板圖才能分享",
  "paper_shared_notice": "此論文已公開分享",
  "paper_share_link": "分享連結",
  "paper_copy_link": "複製連結",
  "paper_link_copied": "連結已複製",
  "paper_unshare": "取消公開",
  "paper_public_badge": "公開分享",
  "explore_title": "公開畫廊",
  "explore_description": "探索其他用戶分享的論文總結",
  "explore_empty_title": "暫無公開的論文",
  "explore_empty_description": "成為第一個分享論文總結的用戶吧！",
  "nav_explore": "畫廊"
```

**Step 3: 添加英文翻译**

在 `messages/en.json` 添加:

```json
  "paper_share_to_gallery": "Share to Public Gallery",
  "paper_share_description": "Let more people see your paper summary",
  "paper_share_button": "Share to Gallery",
  "paper_share_requirement": "Paper must be completed with whiteboard image to share",
  "paper_shared_notice": "This paper is publicly shared",
  "paper_share_link": "Share Link",
  "paper_copy_link": "Copy Link",
  "paper_link_copied": "Link Copied",
  "paper_unshare": "Unshare",
  "paper_public_badge": "Public",
  "explore_title": "Public Gallery",
  "explore_description": "Explore paper summaries shared by others",
  "explore_empty_title": "No public papers yet",
  "explore_empty_description": "Be the first to share a paper summary!",
  "nav_explore": "Gallery"
```

**Step 4: 添加日文翻译**

在 `messages/ja.json` 添加:

```json
  "paper_share_to_gallery": "公開ギャラリーに共有",
  "paper_share_description": "あなたの論文要約をもっと多くの人に見てもらいましょう",
  "paper_share_button": "ギャラリーに共有",
  "paper_share_requirement": "共有するには処理が完了し、ホワイトボード画像が生成されている必要があります",
  "paper_shared_notice": "この論文は公開共有されています",
  "paper_share_link": "共有リンク",
  "paper_copy_link": "リンクをコピー",
  "paper_link_copied": "リンクをコピーしました",
  "paper_unshare": "共有を解除",
  "paper_public_badge": "公開",
  "explore_title": "公開ギャラリー",
  "explore_description": "他のユーザーが共有した論文要約を探索",
  "explore_empty_title": "まだ公開論文がありません",
  "explore_empty_description": "最初に論文要約を共有するユーザーになりましょう！",
  "nav_explore": "ギャラリー"
```

**Step 5: 提交**

```bash
git add messages/*.json
git commit -m "feat: add i18n translations for paper sharing"
```

---

## Task 6: 前端组件 - 分享横幅

**Files:**
- Create: `src/components/papers/share-banner.tsx`

**Step 1: 创建分享横幅组件**

使用 frontend-design skill 创建 `src/components/papers/share-banner.tsx`

**Step 2: 提交**

```bash
git add src/components/papers/share-banner.tsx
git commit -m "feat: add paper share banner component"
```

---

## Task 7: 前端组件 - 公开徽章

**Files:**
- Create: `src/components/papers/public-badge.tsx`

**Step 1: 创建公开徽章组件**

使用 frontend-design skill 创建 `src/components/papers/public-badge.tsx`

**Step 2: 提交**

```bash
git add src/components/papers/public-badge.tsx
git commit -m "feat: add public badge component"
```

---

## Task 8: 前端页面 - 公开画廊

**Files:**
- Create: `src/routes/explore/index.tsx`

**Step 1: 创建画廊页面**

使用 frontend-design skill 创建 `src/routes/explore/index.tsx`

**Step 2: 提交**

```bash
git add src/routes/explore/index.tsx
git commit -m "feat: add public gallery page"
```

---

## Task 9: 集成到论文详情页

**Files:**
- Modify: `src/routes/papers/$paperId.tsx`

**Step 1: 导入分享横幅和公开徽章**

在文件顶部添加导入:

```typescript
import { ShareBanner } from "#/components/papers/share-banner";
import { PublicBadge } from "#/components/papers/public-badge";
```

**Step 2: 在面包屑下方添加分享横幅**

在面包屑导航后添加（约第 197 行后）:

```typescript
        {/* Share Banner - only show to owner */}
        {paper.userId === profile.data?.id && (
          <ShareBanner
            paperId={paper.id}
            isPublic={paper.isPublic}
            canShare={
              paper.status === "completed" && !!result?.whiteboardImageR2Key
            }
          />
        )}
```

**Step 3: 在侧边栏添加公开徽章**

在状态徽章下方添加（约第 230 行后）:

```typescript
                {paper.isPublic && (
                  <div className="mt-2">
                    <PublicBadge />
                  </div>
                )}
```

**Step 4: 提交**

```bash
git add src/routes/papers/\$paperId.tsx
git commit -m "feat: integrate sharing UI into paper detail page"
```

---

## Task 10: 集成到论文列表页

**Files:**
- Modify: `src/components/papers/paper-list.tsx`

**Step 1: 导入公开徽章**

```typescript
import { PublicBadge } from "./public-badge";
```

**Step 2: 在 PaperCard 中添加徽章**

在卡片右上角添加公开徽章（根据现有布局调整位置）

**Step 3: 提交**

```bash
git add src/components/papers/paper-list.tsx
git commit -m "feat: show public badge in paper list"
```

---

## Task 11: 添加导航链接

**Files:**
- Modify: `src/components/Header.tsx`

**Step 1: 添加画廊链接**

在导航菜单中添加画廊链接（在"论文"和"积分"之间）:

```typescript
<Link
  to="/explore"
  className="nav-link"
  activeProps={{ className: "active" }}
>
  {m.nav_explore()}
</Link>
```

**Step 2: 提交**

```bash
git add src/components/Header.tsx
git commit -m "feat: add gallery link to navigation"
```

---

## Task 12: 测试和验证

**Step 1: 启动开发服务器**

```bash
npm run dev
```

**Step 2: 手动测试清单**

- [ ] 数据库迁移成功
- [ ] 完成的论文可以分享
- [ ] 未完成的论文不能分享
- [ ] 没有白板图的论文不能分享
- [ ] 分享后显示横幅和徽章
- [ ] 可以取消分享
- [ ] 公开画廊显示所有公开论文
- [ ] 画廊卡片布局正确
- [ ] 点击卡片跳转到详情页
- [ ] 非创建者可以查看公开论文
- [ ] 非创建者不能查看私有论文
- [ ] 所有语言的翻译正确显示

**Step 3: 修复发现的问题**

根据测试结果修复问题并提交

---

## 完成

所有任务完成后，功能应该完全可用。用户可以：
1. 将完成的论文分享到公开画廊
2. 在画廊浏览其他人分享的论文
3. 随时取消分享
4. 看到明显的公开标识
