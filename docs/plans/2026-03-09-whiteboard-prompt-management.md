# 白板 Prompt 管理功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现用户自定义白板 Prompt 模板管理功能，允许用户创建、编辑、删除和选择不同的 prompt 模板来生成白板图。

**Architecture:** 创建新的数据表存储用户的 prompt 模板，新增 tRPC router 处理 CRUD 操作，创建独立的管理页面，在上传对话框中集成模板选择器，修改白板图生成逻辑支持自定义模板。

**Tech Stack:** Drizzle ORM, tRPC, TanStack Router, TanStack Query, React, Zod, Paraglide (i18n)

---

## Task 1: 数据库 Schema 和迁移

**Files:**
- Modify: `src/db/schema.ts` (添加 whiteboardPrompts 表定义)
- Create: `drizzle/0008_add_whiteboard_prompts.sql`

**Step 1: 在 schema.ts 中添加 whiteboardPrompts 表定义**

在 `src/db/schema.ts` 文件末尾添加：

```typescript
// 白板 Prompt 模板表
export const whiteboardPrompts = sqliteTable(
  "whiteboard_prompts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    promptTemplate: text("prompt_template").notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("whiteboard_prompts_user_id_idx").on(
      table.userId,
      table.isDefault,
    ),
  }),
);
```

**Step 2: 生成数据库迁移文件**

运行命令：
```bash
npm run db:generate
```

预期输出：生成新的迁移文件 `drizzle/0008_*.sql`

**Step 3: 应用数据库迁移**

运行命令：
```bash
npm run db:migrate
```

预期输出：迁移成功应用

**Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/0008_*.sql
git commit -m "feat: add whiteboard_prompts table schema"
```

---

## Task 2: 添加 i18n 翻译

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`
- Modify: `messages/zh-TW.json`
- Modify: `messages/ja.json`

**Step 1: 添加英文翻译**

在 `messages/en.json` 中添加：

```json
{
  "whiteboard_prompt_system_default": "System Default",
  "whiteboard_prompt_page_title": "Whiteboard Prompt Management",
  "whiteboard_prompt_page_description": "Manage your whiteboard generation prompt templates",
  "whiteboard_prompt_create": "Create New Template",
  "whiteboard_prompt_empty_state": "No custom prompt templates yet",
  "whiteboard_prompt_empty_hint": "Create a template to customize whiteboard generation, or use the system default",
  "whiteboard_prompt_name": "Template Name",
  "whiteboard_prompt_name_placeholder": "e.g., Academic Style, Concise Version",
  "whiteboard_prompt_content": "Prompt Content",
  "whiteboard_prompt_content_placeholder": "Enter your prompt template...",
  "whiteboard_prompt_variables_hint": "Available placeholders: {contentText} (required), {whiteboardMarkdown}, {languageInstruction}",
  "whiteboard_prompt_content_text_required_hint": "{contentText} must appear exactly once",
  "whiteboard_prompt_edit": "Edit",
  "whiteboard_prompt_delete": "Delete",
  "whiteboard_prompt_set_default": "Set as Default",
  "whiteboard_prompt_default_badge": "Default",
  "whiteboard_prompt_validation_name_required": "Template name is required",
  "whiteboard_prompt_validation_name_length": "Template name must be between 1-50 characters",
  "whiteboard_prompt_validation_name_duplicate": "Template name already exists",
  "whiteboard_prompt_validation_content_required": "Prompt content is required",
  "whiteboard_prompt_validation_content_length": "Prompt content must be between 10-3000 characters",
  "whiteboard_prompt_validation_content_text_required": "Prompt must contain {contentText} placeholder",
  "whiteboard_prompt_validation_content_text_once": "Prompt can only contain one {contentText} placeholder",
  "whiteboard_prompt_delete_confirm": "Are you sure you want to delete this template?",
  "whiteboard_prompt_delete_default_confirm": "Are you sure you want to delete the default template? The system default will be used.",
  "whiteboard_prompt_delete_success": "Template deleted",
  "whiteboard_prompt_create_success": "Template created",
  "whiteboard_prompt_update_success": "Template updated",
  "upload_select_prompt_template": "Prompt Template"
}
```

**Step 2: 添加简体中文翻译**

在 `messages/zh-CN.json` 中添加对应的中文翻译。

**Step 3: 添加繁体中文翻译**

在 `messages/zh-TW.json` 中添加对应的繁体中文翻译。

**Step 4: 添加日文翻译**

在 `messages/ja.json` 中添加对应的日文翻译。

**Step 5: Commit**

```bash
git add messages/*.json
git commit -m "i18n: add whiteboard prompt management translations"
```

---

## Task 3: 创建 Prompt 验证工具函数

**Files:**
- Create: `src/lib/prompt-validation.ts`

**Step 1: 创建验证函数文件**

创建 `src/lib/prompt-validation.ts`：

```typescript
/**
 * 验证 prompt 模板是否包含正确数量的 {contentText} 占位符
 */
export function validatePromptTemplate(template: string): {
  valid: boolean;
  error?: string;
} {
  const contentTextCount = (template.match(/\{contentText\}/g) || []).length;

  if (contentTextCount === 0) {
    return {
      valid: false,
      error: "whiteboard_prompt_validation_content_text_required",
    };
  }

  if (contentTextCount > 1) {
    return {
      valid: false,
      error: "whiteboard_prompt_validation_content_text_once",
    };
  }

  return { valid: true };
}

/**
 * 替换 prompt 模板中的占位符
 */
export function buildPromptFromTemplate(
  template: string,
  whiteboardMarkdown: string,
  contentText: string,
  language: "en" | "zh-cn" | "zh-tw" | "ja",
): string {
  const languageInstruction =
    language === "zh-cn"
      ? "请用简体中文生成白板图，包括所有文字、标注和说明。"
      : language === "zh-tw"
        ? "請用繁體中文生成白板圖，包括所有文字、標註和說明。"
        : language === "ja"
          ? "日本語でホワイトボード図を生成してください。すべてのテキスト、ラベル、説明を含めてください。"
          : "Generate the whiteboard in English, including all text, labels, and captions.";

  return template
    .replace(/\{whiteboardMarkdown\}/g, whiteboardMarkdown)
    .replace(/\{contentText\}/g, contentText)
    .replace(/\{languageInstruction\}/g, languageInstruction);
}

/**
 * 获取系统默认 prompt 模板
 */
export function getSystemDefaultPromptTemplate(): string {
  return `Transform this academic paper into a professor-style whiteboard image. Include diagrams, arrows, boxes, and short captions that explain the core ideas visually.

{languageInstruction}

Key insights to emphasize:
{whiteboardMarkdown}

Paper content:
{contentText}

Requirements:
- Create a hand-drawn whiteboard aesthetic with a clean, academic style
- Use boxes and circles to highlight key concepts from the insights above
- Draw arrows to show relationships and flow between ideas
- Include key formulas and equations prominently (extract from paper content)
- Use different sections or colors to organize main topics
- Make the text readable and well-organized
- Ensure good spacing to avoid clutter
- Use a professional, academic color palette (black, blue, red for emphasis)
- Mimic the style of a university professor explaining concepts on a whiteboard
- Focus on visualizing the insights and their connections, not just listing information`;
}
```

**Step 2: Commit**

```bash
git add src/lib/prompt-validation.ts
git commit -m "feat: add prompt template validation utilities"
```

---

## Task 4: 创建 tRPC Router

**Files:**
- Create: `src/integrations/trpc/routers/whiteboard-prompt.ts`
- Modify: `src/integrations/trpc/router.ts`

**Step 1: 创建 whiteboard-prompt router**

创建 `src/integrations/trpc/routers/whiteboard-prompt.ts`：

```typescript
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { whiteboardPrompts } from "#/db/schema";
import { validatePromptTemplate } from "#/lib/prompt-validation";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { protectedProcedure, router } from "../init";

function assertGuestWriteAllowed(session: { user: { id: string } }) {
  if (isReviewGuestReadOnlySession(session)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Review guest mode is read-only",
    });
  }
}

export const whiteboardPromptRouter = router({
  /**
   * 获取用户的所有 prompt 模板列表
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const prompts = await ctx.db.query.whiteboardPrompts.findMany({
      where: eq(whiteboardPrompts.userId, ctx.session.user.id),
      orderBy: [desc(whiteboardPrompts.isDefault), asc(whiteboardPrompts.createdAt)],
    });

    return prompts;
  }),

  /**
   * 创建新的 prompt 模板
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(50),
        promptTemplate: z.string().min(10).max(3000),
        isDefault: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);

      // 验证 prompt 模板
      const validation = validatePromptTemplate(input.promptTemplate);
      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: validation.error,
        });
      }

      // 检查名称是否重复
      const existing = await ctx.db.query.whiteboardPrompts.findFirst({
        where: and(
          eq(whiteboardPrompts.userId, ctx.session.user.id),
          eq(whiteboardPrompts.name, input.name),
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "whiteboard_prompt_validation_name_duplicate",
        });
      }

      // 如果设置为默认，取消其他模板的默认状态
      if (input.isDefault) {
        await ctx.db
          .update(whiteboardPrompts)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(whiteboardPrompts.userId, ctx.session.user.id),
              eq(whiteboardPrompts.isDefault, true),
            ),
          );
      }

      // 创建新模板
      const [newPrompt] = await ctx.db
        .insert(whiteboardPrompts)
        .values({
          userId: ctx.session.user.id,
          name: input.name,
          promptTemplate: input.promptTemplate,
          isDefault: input.isDefault,
        })
        .returning();

      return newPrompt;
    }),

  /**
   * 更新 prompt 模板
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(50).optional(),
        promptTemplate: z.string().min(10).max(3000).optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);

      // 验证模板是否存在且属于当前用户
      const existing = await ctx.db.query.whiteboardPrompts.findFirst({
        where: and(
          eq(whiteboardPrompts.id, input.id),
          eq(whiteboardPrompts.userId, ctx.session.user.id),
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt template not found",
        });
      }

      // 如果更新了 prompt 内容，验证格式
      if (input.promptTemplate) {
        const validation = validatePromptTemplate(input.promptTemplate);
        if (!validation.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: validation.error,
          });
        }
      }

      // 如果更新了名称，检查是否重复
      if (input.name && input.name !== existing.name) {
        const duplicate = await ctx.db.query.whiteboardPrompts.findFirst({
          where: and(
            eq(whiteboardPrompts.userId, ctx.session.user.id),
            eq(whiteboardPrompts.name, input.name),
          ),
        });

        if (duplicate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "whiteboard_prompt_validation_name_duplicate",
          });
        }
      }

      // 如果设置为默认，取消其他模板的默认状态
      if (input.isDefault) {
        await ctx.db
          .update(whiteboardPrompts)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(whiteboardPrompts.userId, ctx.session.user.id),
              eq(whiteboardPrompts.isDefault, true),
            ),
          );
      }

      // 更新模板
      const [updated] = await ctx.db
        .update(whiteboardPrompts)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(whiteboardPrompts.id, input.id))
        .returning();

      return updated;
    }),

  /**
   * 删除 prompt 模板
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);

      // 验证模板是否存在且属于当前用户
      const existing = await ctx.db.query.whiteboardPrompts.findFirst({
        where: and(
          eq(whiteboardPrompts.id, input.id),
          eq(whiteboardPrompts.userId, ctx.session.user.id),
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt template not found",
        });
      }

      // 删除模板
      await ctx.db
        .delete(whiteboardPrompts)
        .where(eq(whiteboardPrompts.id, input.id));

      // 如果删除的是默认模板，自动设置最早的模板为默认
      if (existing.isDefault) {
        const oldestPrompt = await ctx.db.query.whiteboardPrompts.findFirst({
          where: eq(whiteboardPrompts.userId, ctx.session.user.id),
          orderBy: asc(whiteboardPrompts.createdAt),
        });

        if (oldestPrompt) {
          await ctx.db
            .update(whiteboardPrompts)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(eq(whiteboardPrompts.id, oldestPrompt.id));
        }
      }

      return { success: true };
    }),

  /**
   * 获取指定的 prompt 模板（用于生成白板图）
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // 如果指定了 ID，获取该模板
      if (input.id) {
        const prompt = await ctx.db.query.whiteboardPrompts.findFirst({
          where: and(
            eq(whiteboardPrompts.id, input.id),
            eq(whiteboardPrompts.userId, ctx.session.user.id),
          ),
        });

        if (prompt) return prompt;
      }

      // 获取用户的默认模板
      const defaultPrompt = await ctx.db.query.whiteboardPrompts.findFirst({
        where: and(
          eq(whiteboardPrompts.userId, ctx.session.user.id),
          eq(whiteboardPrompts.isDefault, true),
        ),
      });

      // 如果没有默认模板，返回 null（使用系统默认）
      return defaultPrompt || null;
    }),
});
```

**Step 2: 在主 router 中注册**

修改 `src/integrations/trpc/router.ts`，添加：

```typescript
import { whiteboardPromptRouter } from "./routers/whiteboard-prompt";

export const appRouter = router({
  // ... 其他 router
  whiteboardPrompt: whiteboardPromptRouter,
});
```

**Step 3: Commit**

```bash
git add src/integrations/trpc/routers/whiteboard-prompt.ts src/integrations/trpc/router.ts
git commit -m "feat: add whiteboard prompt tRPC router"
```

---

## Task 5: 创建 Prompt 管理页面组件

**Files:**
- Create: `src/routes/whiteboard-prompts/index.tsx`
- Create: `src/routes/whiteboard-prompts/styles.module.css`
- Create: `src/components/whiteboard-prompts/prompt-dialog.tsx`

**Step 1: 创建页面主组件**

创建 `src/routes/whiteboard-prompts/index.tsx`（前50行）：

```typescript
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, Edit3, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { PromptDialog } from "#/components/whiteboard-prompts/prompt-dialog";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Skeleton } from "#/components/ui/skeleton";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";
import styles from "./styles.module.css";

export const Route = createFileRoute("/whiteboard-prompts/")({
  component: WhiteboardPromptsPage,
});

type WhiteboardPrompt = {
  id: string;
  name: string;
  promptTemplate: string;
  isDefault: boolean;
  createdAt: Date;
};

function WhiteboardPromptsPage() {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<string | null>(null);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | undefined>();
  const trpc = useTRPC();

  const { session, isSessionPending } = useRequireAuth("/whiteboard-prompts");

  const promptsQuery = useQuery(trpc.whiteboardPrompt.list.queryOptions());

  const deleteMutation = useMutation({
    ...trpc.whiteboardPrompt.delete.mutationOptions(),
    onSuccess: () => {
      promptsQuery.refetch();
      setDeleteDialogOpen(false);
      setPromptToDelete(null);
    },
  });

  const setDefaultMutation = useMutation({
    ...trpc.whiteboardPrompt.update.mutationOptions(),
    onSuccess: () => {
      promptsQuery.refetch();
    },
  });

  const handleDelete = (id: string) => {
    setPromptToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (promptToDelete) {
      deleteMutation.mutate({ id: promptToDelete });
    }
  };

  const handleSetDefault = (id: string) => {
    setDefaultMutation.mutate({ id, isDefault: true });
  };

  const handleEdit = (id: string) => {
    setEditingPromptId(id);
    setPromptDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingPromptId(undefined);
    setPromptDialogOpen(true);
  };

  const handleDialogClose = () => {
    setPromptDialogOpen(false);
    setEditingPromptId(undefined);
    promptsQuery.refetch();
  };

  if (isSessionPending || !session) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className={styles.grid}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  const prompts = promptsQuery.data || [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{m.whiteboard_prompt_page_title()}</h1>
          <p className={styles.description}>
            {m.whiteboard_prompt_page_description()}
          </p>
        </div>
        <Button onClick={handleCreate} className={styles.createButton}>
          <Plus className="mr-2 h-4 w-4" />
          {m.whiteboard_prompt_create()}
        </Button>
      </div>

      {prompts.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{m.whiteboard_prompt_empty_state()}</p>
          <p className={styles.emptyHint}>{m.whiteboard_prompt_empty_hint()}</p>
          <Button onClick={handleCreate} className="mt-4">
            <Plus className="mr-2 h-4 w-4" />
            {m.whiteboard_prompt_create()}
          </Button>
        </div>
      ) : (
        <div className={styles.grid}>
          {prompts.map((prompt) => (
            <div key={prompt.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  {prompt.name}
                  {prompt.isDefault && (
                    <span className={styles.defaultBadge}>
                      <Star className="h-3 w-3" />
                      {m.whiteboard_prompt_default_badge()}
                    </span>
                  )}
                </div>
                <div className={styles.cardMeta}>
                  <Clock className="h-3 w-3" />
                  {new Date(prompt.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className={styles.cardContent}>
                <p className={styles.promptPreview}>
                  {prompt.promptTemplate.substring(0, 150)}...
                </p>
              </div>
              <div className={styles.cardActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEdit(prompt.id)}
                >
                  <Edit3 className="mr-1 h-3 w-3" />
                  {m.whiteboard_prompt_edit()}
                </Button>
                {!prompt.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSetDefault(prompt.id)}
                  >
                    <Star className="mr-1 h-3 w-3" />
                    {m.whiteboard_prompt_set_default()}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(prompt.id)}
                  className={styles.deleteButton}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  {m.whiteboard_prompt_delete()}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PromptDialog
        open={promptDialogOpen}
        onClose={handleDialogClose}
        editingPromptId={editingPromptId}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.whiteboard_prompt_delete()}</DialogTitle>
            <DialogDescription>
              {prompts.find((p) => p.id === promptToDelete)?.isDefault
                ? m.whiteboard_prompt_delete_default_confirm()
                : m.whiteboard_prompt_delete_confirm()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteDialogOpen(false)}
            >
              {m.cancel()}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
            >
              {m.whiteboard_prompt_delete()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

**Step 2: 创建样式文件**

创建 `src/routes/whiteboard-prompts/styles.module.css`：

```css
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
}

.title {
  font-size: 1.875rem;
  font-weight: 600;
  font-family: var(--font-serif);
  color: var(--ink);
  margin-bottom: 0.5rem;
}

.description {
  color: var(--ink-soft);
  font-size: 0.875rem;
}

.createButton {
  background-color: var(--academic-brown);
}

.createButton:hover {
  background-color: var(--academic-brown-deep);
}

.emptyState {
  text-align: center;
  padding: 4rem 2rem;
  border: 2px dashed var(--line);
  border-radius: 1rem;
  background-color: var(--parchment);
}

.emptyTitle {
  font-size: 1.125rem;
  font-weight: 500;
  color: var(--ink);
  margin-bottom: 0.5rem;
}

.emptyHint {
  color: var(--ink-soft);
  font-size: 0.875rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 1.5rem;
}

.card {
  border: 1px solid var(--line);
  border-radius: 1rem;
  padding: 1.5rem;
  background-color: var(--parchment);
  transition: box-shadow 0.2s;
}

.card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.cardHeader {
  margin-bottom: 1rem;
}

.cardTitle {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.defaultBadge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  background-color: var(--academic-brown);
  color: white;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.cardMeta {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--ink-soft);
  font-size: 0.75rem;
}

.cardContent {
  margin-bottom: 1rem;
}

.promptPreview {
  color: var(--ink-soft);
  font-size: 0.875rem;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.cardActions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.deleteButton {
  color: var(--sienna);
}

.deleteButton:hover {
  background-color: var(--sienna-light);
}
```

**Step 3: 创建对话框组件**

创建 `src/components/whiteboard-prompts/prompt-dialog.tsx`（前50行）：

```typescript
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useTRPC } from "#/integrations/trpc/react";
import { getSystemDefaultPromptTemplate } from "#/lib/prompt-validation";
import { m } from "#/paraglide/messages";

interface PromptDialogProps {
  open: boolean;
  onClose: () => void;
  editingPromptId?: string;
}

export function PromptDialog({
  open,
  onClose,
  editingPromptId,
}: PromptDialogProps) {
  const [name, setName] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const trpc = useTRPC();

  // 获取编辑的 prompt 数据
  const promptsQuery = useQuery({
    ...trpc.whiteboardPrompt.list.queryOptions(),
    enabled: !!editingPromptId,
  });

  const createMutation = useMutation(trpc.whiteboardPrompt.create.mutationOptions());
  const updateMutation = useMutation(trpc.whiteboardPrompt.update.mutationOptions());

  // 加载编辑数据
  useEffect(() => {
    if (editingPromptId && promptsQuery.data) {
      const prompt = promptsQuery.data.find((p) => p.id === editingPromptId);
      if (prompt) {
        setName(prompt.name);
        setPromptTemplate(prompt.promptTemplate);
        setIsDefault(prompt.isDefault);
      }
    } else {
      // 新建时使用系统默认模板作为参考
      setName("");
      setPromptTemplate(getSystemDefaultPromptTemplate());
      setIsDefault(false);
    }
    setErrors({});
  }, [editingPromptId, promptsQuery.data, open]);

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = m.whiteboard_prompt_validation_name_required();
    } else if (name.length > 50) {
      newErrors.name = m.whiteboard_prompt_validation_name_length();
    }

    if (!promptTemplate.trim()) {
      newErrors.promptTemplate = m.whiteboard_prompt_validation_content_required();
    } else if (promptTemplate.length < 10 || promptTemplate.length > 3000) {
      newErrors.promptTemplate = m.whiteboard_prompt_validation_content_length();
    } else {
      const contentTextCount = (promptTemplate.match(/\{contentText\}/g) || []).length;
      if (contentTextCount === 0) {
        newErrors.promptTemplate = m.whiteboard_prompt_validation_content_text_required();
      } else if (contentTextCount > 1) {
        newErrors.promptTemplate = m.whiteboard_prompt_validation_content_text_once();
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    try {
      if (editingPromptId) {
        await updateMutation.mutateAsync({
          id: editingPromptId,
          name,
          promptTemplate,
          isDefault,
        });
      } else {
        await createMutation.mutateAsync({
          name,
          promptTemplate,
          isDefault,
        });
      }
      onClose();
    } catch (error) {
      console.error("Failed to save prompt:", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {editingPromptId
              ? m.whiteboard_prompt_edit()
              : m.whiteboard_prompt_create()}
          </DialogTitle>
          <DialogDescription>
            {m.whiteboard_prompt_variables_hint()}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">{m.whiteboard_prompt_name()}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.whiteboard_prompt_name_placeholder()}
              className={errors.name ? "border-red-500" : ""}
            />
            {errors.name && (
              <p className="text-sm text-red-500 mt-1">{errors.name}</p>
            )}
          </div>
          <div>
            <Label htmlFor="promptTemplate">
              {m.whiteboard_prompt_content()}
            </Label>
            <Textarea
              id="promptTemplate"
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              placeholder={m.whiteboard_prompt_content_placeholder()}
              rows={12}
              className={errors.promptTemplate ? "border-red-500" : ""}
            />
            {errors.promptTemplate && (
              <p className="text-sm text-red-500 mt-1">{errors.promptTemplate}</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              {m.whiteboard_prompt_content_text_required_hint()}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            <Label htmlFor="isDefault" className="cursor-pointer">
              {m.whiteboard_prompt_set_default()}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {m.cancel()}
          </Button>
          <Button
            onClick={handleSave}
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {m.save()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Commit**

```bash
git add src/routes/whiteboard-prompts/ src/components/whiteboard-prompts/
git commit -m "feat: add whiteboard prompt management page"
```

---

## Task 6: 在导航栏添加入口

**Files:**
- Modify: `src/components/Header.tsx`

**Step 1: 在 Header 组件中添加导航链接**

在 `src/components/Header.tsx` 的导航链接部分添加：

```typescript
<Link
  to="/whiteboard-prompts"
  className="text-sm font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] transition-colors"
>
  {m.whiteboard_prompt_page_title()}
</Link>
```

**Step 2: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat: add whiteboard prompts link to header"
```

---

## Task 7: 修改上传对话框集成 Prompt 选择器

**Files:**
- Modify: `src/components/papers/upload-dialog.tsx`

**Step 1: 添加 Prompt 选择器组件**

在 `upload-dialog.tsx` 中添加新的组件：

```typescript
interface PromptSelectorProps {
  selectedPromptId: string | undefined;
  prompts: Array<{ id: string; name: string; isDefault: boolean }> | undefined;
  onPromptChange: (value: string) => void;
}

function PromptSelector({
  selectedPromptId,
  prompts,
  onPromptChange,
}: PromptSelectorProps) {
  const hasPrompts = prompts && prompts.length > 0;

  if (!hasPrompts) {
    return null; // 没有自定义模板时不显示选择器
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm text-[var(--ink-soft)]">
        {m.upload_select_prompt_template()}
      </Label>
      <Select value={selectedPromptId} onValueChange={onPromptChange}>
        <SelectTrigger className="border-[var(--line)]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {prompts.map((prompt) => (
            <SelectItem key={prompt.id} value={prompt.id}>
              {prompt.name}
              {prompt.isDefault && ` (${m.whiteboard_prompt_default_badge()})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

**Step 2: 在 UploadDialog 中集成**

在 `UploadDialog` 组件中：

1. 添加状态：
```typescript
const [selectedPromptId, setSelectedPromptId] = useState<string | undefined>(undefined);
```

2. 获取 prompt 列表：
```typescript
const { data: prompts } = useQuery({
  ...trpc.whiteboardPrompt.list.queryOptions(),
  enabled: !!session,
});
```

3. 设置默认选中：
```typescript
useEffect(() => {
  if (prompts && prompts.length > 0) {
    const defaultPrompt = prompts.find((p) => p.isDefault);
    if (defaultPrompt) {
      setSelectedPromptId(defaultPrompt.id);
    } else {
      setSelectedPromptId(prompts[0].id);
    }
  }
}, [prompts]);
```

4. 在语言选择器下方添加 Prompt 选择器：
```typescript
<div className="mt-4">
  <PromptSelector
    selectedPromptId={selectedPromptId}
    prompts={prompts}
    onPromptChange={(value) => setSelectedPromptId(value)}
  />
</div>
```

5. 在提交时传递 promptId：
```typescript
await createPaper.mutateAsync({
  // ... 其他参数
  promptId: selectedPromptId,
});
```

**Step 3: Commit**

```bash
git add src/components/papers/upload-dialog.tsx
git commit -m "feat: integrate prompt selector in upload dialog"
```

---

## Task 8: 修改后端支持自定义 Prompt

**Files:**
- Modify: `src/integrations/trpc/routers/paper.ts`
- Modify: `src/workers/queue-consumer.ts`
- Modify: `src/lib/ai.ts`

**Step 1: 修改 paper router 接收 promptId**

在 `src/integrations/trpc/routers/paper.ts` 的 `create` 方法中添加：

```typescript
.input(
  z.object({
    // ... 其他字段
    promptId: z.string().optional(),
  }),
)
```

将 `promptId` 传递给队列消费者。

**Step 2: 修改队列消费者处理 promptId**

在 `src/workers/queue-consumer.ts` 中：

1. 从消息中获取 `promptId`
2. 调用 `trpc.whiteboardPrompt.get` 获取模板
3. 将模板传递给 `generateWhiteboardImage`

**Step 3: 修改 ai.ts 支持自定义模板**

在 `src/lib/ai.ts` 中修改 `generateWhiteboardImage` 函数：

```typescript
export async function generateWhiteboardImage(
  whiteboardMarkdown: string,
  paperText: string,
  config: AIConfig,
  language: "en" | "zh-cn" | "zh-tw" | "ja" = "en",
  summary?: string,
  customPromptTemplate?: string, // 新增参数
): Promise<{ imageData: ArrayBuffer; prompt: string }> {
  // 使用自定义模板或默认模板
  const promptTemplate = customPromptTemplate || getSystemDefaultPromptTemplate();

  // 先尝试使用完整论文文本
  try {
    const prompt = buildPromptFromTemplate(
      promptTemplate,
      whiteboardMarkdown,
      paperText,
      language,
    );

    if (isOpenRouter) {
      return await generateWhiteboardImageWithOpenRouter(prompt, config);
    }
    return await generateWhiteboardImageWithGemini(prompt, config);
  } catch (error) {
    // 降级逻辑保持不变
    if (summary) {
      const promptWithSummary = buildPromptFromTemplate(
        promptTemplate,
        whiteboardMarkdown,
        summary,
        language,
      );
      // ...
    }
    throw error;
  }
}
```

删除原有的 `buildWhiteboardPrompt` 函数，使用 `prompt-validation.ts` 中的 `buildPromptFromTemplate`。

**Step 4: Commit**

```bash
git add src/integrations/trpc/routers/paper.ts src/workers/queue-consumer.ts src/lib/ai.ts
git commit -m "feat: support custom prompt templates in whiteboard generation"
```

---

## Task 9: 测试和修复

**Step 1: 运行开发服务器**

```bash
npm run dev
```

**Step 2: 测试创建 Prompt 模板**

1. 访问 `/whiteboard-prompts`
2. 点击"创建新模板"
3. 输入名称和 prompt 内容
4. 保存并验证是否成功创建

**Step 3: 测试编辑和删除**

1. 编辑已创建的模板
2. 删除非默认模板
3. 删除默认模板，验证自动回退逻辑

**Step 4: 测试上传论文**

1. 访问首页
2. 点击上传论文
3. 验证 Prompt 选择器是否显示
4. 选择不同的模板上传论文
5. 验证生成的白板图是否使用了自定义 prompt

**Step 5: 修复发现的问题**

根据测试结果修复 bug。

**Step 6: Commit**

```bash
git add .
git commit -m "fix: resolve issues found during testing"
```

---

## Task 10: 运行 Biome 检查

**Step 1: 运行 Biome 检查**

```bash
npm run lint
```

**Step 2: 修复 Biome 报告的问题**

```bash
npm run lint:fix
```

**Step 3: Commit**

```bash
git add .
git commit -m "chore: fix biome issues"
```

---

## Task 11: 最终验证和文档

**Step 1: 完整功能测试**

1. 测试所有 CRUD 操作
2. 测试默认模板逻辑
3. 测试上传论文使用自定义 prompt
4. 测试多语言支持

**Step 2: 更新 README（如果需要）**

如果项目有 README，添加关于 Prompt 管理功能的说明。

**Step 3: 最终 Commit**

```bash
git add .
git commit -m "feat: complete whiteboard prompt management feature"
```

---

## 总结

实现计划已完成，包含以下主要任务：

1. 数据库 Schema 和迁移
2. i18n 翻译
3. Prompt 验证工具函数
4. tRPC Router
5. Prompt 管理页面
6. 导航栏集成
7. 上传对话框集成
8. 后端白板图生成支持
9. 测试和修复
10. 代码质量检查
11. 最终验证

每个任务都包含详细的步骤、代码示例和提交说明，确保实现过程清晰可追踪。
