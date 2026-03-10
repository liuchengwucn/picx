# Multiple Whiteboard Images Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable one paper to have multiple whiteboard images, allowing users to regenerate with different prompts or same prompt (using AI randomness), and manage these images.

**Architecture:** Create new `whiteboardImages` table to store multiple images per paper. Migrate existing `whiteboardImageR2Key` from `paperResults` to new table. Add tRPC endpoints for regeneration, listing, setting default, and deletion. Update UI to show image gallery and regeneration dialog.

**Tech Stack:** Drizzle ORM, D1, tRPC, TanStack Query, React, Cloudflare R2, Cloudflare Queue

---

## Chunk 1: Database Migration

### Task 1: Create Migration Script

**Files:**
- Create: `drizzle/0010_multiple_whiteboard_images.sql`

- [ ] **Step 1: Write migration SQL**

Create the migration file with table creation and data migration:

```sql
-- Create whiteboard_images table
CREATE TABLE `whiteboard_images` (
  `id` text PRIMARY KEY NOT NULL,
  `paper_id` text NOT NULL,
  `image_r2_key` text NOT NULL,
  `prompt_id` text,
  `is_default` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`prompt_id`) REFERENCES `whiteboard_prompts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

-- Create indexes
CREATE INDEX `whiteboard_images_paper_id_idx` ON `whiteboard_images` (`paper_id`);
--> statement-breakpoint
CREATE INDEX `whiteboard_images_paper_default_idx` ON `whiteboard_images` (`paper_id`, `is_default`);
--> statement-breakpoint

-- Migrate existing whiteboard images from paper_results
INSERT INTO `whiteboard_images` (`id`, `paper_id`, `image_r2_key`, `prompt_id`, `is_default`, `created_at`)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) as id,
  pr.paper_id,
  pr.whiteboard_image_r2_key,
  NULL as prompt_id,
  1 as is_default,
  pr.created_at
FROM `paper_results` pr
WHERE pr.whiteboard_image_r2_key IS NOT NULL;
--> statement-breakpoint

-- Drop old columns from paper_results
ALTER TABLE `paper_results` DROP COLUMN `whiteboard_image_r2_key`;
--> statement-breakpoint
ALTER TABLE `paper_results` DROP COLUMN `image_prompt`;
```

- [ ] **Step 2: Update schema.ts**

Add the new table definition to `src/db/schema.ts`:

```typescript
// After whiteboardPrompts table definition, add:

// 白板图表
export const whiteboardImages = sqliteTable(
  "whiteboard_images",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    imageR2Key: text("image_r2_key").notNull(),
    promptId: text("prompt_id").references(() => whiteboardPrompts.id, {
      onDelete: "set null",
    }),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    paperIdIdx: index("whiteboard_images_paper_id_idx").on(table.paperId),
    paperDefaultIdx: index("whiteboard_images_paper_default_idx").on(
      table.paperId,
      table.isDefault,
    ),
  }),
);
```

- [ ] **Step 3: Remove old fields from paperResults schema**

In `src/db/schema.ts`, remove these fields from `paperResults`:

```typescript
// Remove these lines:
whiteboardImageR2Key: text("whiteboard_image_r2_key"),
imagePrompt: text("image_prompt").notNull(),
```

- [ ] **Step 4: Run migration locally**

```bash
npm run db:migrate
```

Expected: Migration runs successfully, new table created, data migrated

- [ ] **Step 5: Commit database changes**

```bash
git add drizzle/0010_multiple_whiteboard_images.sql src/db/schema.ts
git commit -m "feat(db): add whiteboard_images table and migrate data"
```

## Chunk 2: Backend API - List and Get Whiteboards

### Task 2: Add listWhiteboards API

**Files:**
- Modify: `src/integrations/trpc/routers/paper.ts`

- [ ] **Step 1: Add listWhiteboards procedure**

Add after the `listPublic` procedure:

```typescript
/**
 * List all whiteboard images for a paper
 * Public endpoint - allows viewing public papers without auth
 */
listWhiteboards: publicProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input: paperId }) => {
    // Try to get session (optional for public papers)
    const session =
      (await ctx.auth.api.getSession({ headers: ctx.headers })) ??
      (isReviewGuestModeEnabled()
        ? await getReviewGuestServerSession(ctx.db)
        : null);

    const [paper] = await ctx.db
      .select()
      .from(papers)
      .where(and(eq(papers.id, paperId), isNull(papers.deletedAt)))
      .limit(1);

    if (!paper) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Paper not found",
      });
    }

    // Check permission: owner or public paper
    const isOwner = session && paper.userId === session.user.id;
    if (!isOwner && !paper.isPublic) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You don't have permission to view this paper",
      });
    }

    // Get all whiteboard images
    const whiteboards = await ctx.db
      .select({
        id: whiteboardImages.id,
        imageR2Key: whiteboardImages.imageR2Key,
        promptId: whiteboardImages.promptId,
        promptName: whiteboardPrompts.name,
        isDefault: whiteboardImages.isDefault,
        createdAt: whiteboardImages.createdAt,
      })
      .from(whiteboardImages)
      .leftJoin(
        whiteboardPrompts,
        eq(whiteboardImages.promptId, whiteboardPrompts.id),
      )
      .where(eq(whiteboardImages.paperId, paperId))
      .orderBy(desc(whiteboardImages.createdAt));

    return { whiteboards };
  }),
```

- [ ] **Step 2: Import whiteboardImages in paper router**

At the top of `src/integrations/trpc/routers/paper.ts`, add to imports:

```typescript
import {
  creditTransactions,
  paperResults,
  papers,
  user,
  userApiConfigs,
  whiteboardPrompts,
  whiteboardImages,  // Add this
} from "#/db/schema";
```

- [ ] **Step 3: Update getById to include whiteboards**

Modify the `getById` procedure to include whiteboard images. Replace the return statement:

```typescript
// Replace the existing return statements with:
if (result) {
  const summaries = result.summaries as Record<string, string>;
  const currentLanguage = result.summaryLanguage;
  const summary = summaries[currentLanguage] || summaries.en || "";

  // Get default whiteboard
  const [defaultWhiteboard] = await ctx.db
    .select()
    .from(whiteboardImages)
    .where(
      and(
        eq(whiteboardImages.paperId, input),
        eq(whiteboardImages.isDefault, true),
      ),
    )
    .limit(1);

  // Get all whiteboards
  const whiteboards = await ctx.db
    .select()
    .from(whiteboardImages)
    .where(eq(whiteboardImages.paperId, input))
    .orderBy(desc(whiteboardImages.createdAt));

  return {
    paper,
    result: {
      ...result,
      summary,
      availableLanguages: Object.keys(summaries),
      defaultWhiteboard: defaultWhiteboard || null,
    },
    whiteboards,
  };
}

return {
  paper,
  result: null,
  whiteboards: [],
};
```

- [ ] **Step 4: Commit list APIs**

```bash
git add src/integrations/trpc/routers/paper.ts
git commit -m "feat(api): add listWhiteboards and update getById with whiteboards"
```

## Chunk 3: Backend API - Set Default and Delete

### Task 3: Add setDefaultWhiteboard API

**Files:**
- Modify: `src/integrations/trpc/routers/paper.ts`

- [ ] **Step 1: Add setDefaultWhiteboard procedure**

Add after `listWhiteboards`:

```typescript
/**
 * Set a whiteboard image as default
 * Only owner can set default
 */
setDefaultWhiteboard: protectedProcedure
  .input(
    z.object({
      paperId: z.string().uuid(),
      whiteboardId: z.string().uuid(),
    }),
  )
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

    // Check if whiteboard exists and belongs to this paper
    const [whiteboard] = await ctx.db
      .select()
      .from(whiteboardImages)
      .where(
        and(
          eq(whiteboardImages.id, input.whiteboardId),
          eq(whiteboardImages.paperId, input.paperId),
        ),
      )
      .limit(1);

    if (!whiteboard) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Whiteboard image not found",
      });
    }

    // Set all whiteboards for this paper to non-default
    await ctx.db
      .update(whiteboardImages)
      .set({ isDefault: false })
      .where(eq(whiteboardImages.paperId, input.paperId));

    // Set the specified whiteboard as default
    await ctx.db
      .update(whiteboardImages)
      .set({ isDefault: true })
      .where(eq(whiteboardImages.id, input.whiteboardId));

    return { success: true };
  }),
```

- [ ] **Step 2: Commit setDefaultWhiteboard**

```bash
git add src/integrations/trpc/routers/paper.ts
git commit -m "feat(api): add setDefaultWhiteboard endpoint"
```

### Task 4: Add deleteWhiteboard API

**Files:**
- Modify: `src/integrations/trpc/routers/paper.ts`

- [ ] **Step 1: Add deleteWhiteboard procedure**

Add after `setDefaultWhiteboard`:

```typescript
/**
 * Delete a whiteboard image
 * Only owner can delete, must keep at least one whiteboard
 */
deleteWhiteboard: protectedProcedure
  .input(
    z.object({
      paperId: z.string().uuid(),
      whiteboardId: z.string().uuid(),
    }),
  )
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

    // Check if whiteboard exists and belongs to this paper
    const [whiteboard] = await ctx.db
      .select()
      .from(whiteboardImages)
      .where(
        and(
          eq(whiteboardImages.id, input.whiteboardId),
          eq(whiteboardImages.paperId, input.paperId),
        ),
      )
      .limit(1);

    if (!whiteboard) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Whiteboard image not found",
      });
    }

    // Check if there are at least 2 whiteboards
    const [countResult] = await ctx.db
      .select({ count: count() })
      .from(whiteboardImages)
      .where(eq(whiteboardImages.paperId, input.paperId));

    if (countResult.count <= 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot delete the last whiteboard image",
      });
    }

    // Delete from R2
    try {
      await ctx.env.R2_BUCKET.delete(whiteboard.imageR2Key);
    } catch (error) {
      console.error("Failed to delete from R2:", error);
      // Continue with database deletion even if R2 deletion fails
    }

    // Delete from database
    await ctx.db
      .delete(whiteboardImages)
      .where(eq(whiteboardImages.id, input.whiteboardId));

    // If deleted whiteboard was default, set the latest one as default
    if (whiteboard.isDefault) {
      const [latestWhiteboard] = await ctx.db
        .select()
        .from(whiteboardImages)
        .where(eq(whiteboardImages.paperId, input.paperId))
        .orderBy(desc(whiteboardImages.createdAt))
        .limit(1);

      if (latestWhiteboard) {
        await ctx.db
          .update(whiteboardImages)
          .set({ isDefault: true })
          .where(eq(whiteboardImages.id, latestWhiteboard.id));
      }
    }

    return { success: true };
  }),
```

- [ ] **Step 2: Commit deleteWhiteboard**

```bash
git add src/integrations/trpc/routers/paper.ts
git commit -m "feat(api): add deleteWhiteboard endpoint"
```

## Chunk 4: Backend API - Regenerate Whiteboard

### Task 5: Add regenerateWhiteboard API

**Files:**
- Modify: `src/integrations/trpc/routers/paper.ts`

- [ ] **Step 1: Add regenerateWhiteboard procedure**

Add after `deleteWhiteboard`:

```typescript
/**
 * Regenerate whiteboard image with same or different prompt
 * Deducts 1 credit if not using user API config
 */
regenerateWhiteboard: protectedProcedure
  .input(
    z.object({
      paperId: z.string().uuid(),
      promptId: z.string().uuid().optional(),
      useExistingPrompt: z.boolean().optional(),
      apiConfigId: z.string().uuid().optional(),
    }),
  )
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
        message: "Paper processing is not completed yet",
      });
    }

    // Validate API config if provided
    if (input.apiConfigId) {
      const [apiConfig] = await ctx.db
        .select({ id: userApiConfigs.id })
        .from(userApiConfigs)
        .where(
          and(
            eq(userApiConfigs.id, input.apiConfigId),
            eq(userApiConfigs.userId, userId),
          ),
        )
        .limit(1);

      if (!apiConfig) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API configuration not found",
        });
      }
    }

    // Validate prompt if provided
    let promptIdToUse: string | undefined = input.promptId;
    if (input.useExistingPrompt) {
      // Get the current default whiteboard's prompt
      const [defaultWhiteboard] = await ctx.db
        .select()
        .from(whiteboardImages)
        .where(
          and(
            eq(whiteboardImages.paperId, input.paperId),
            eq(whiteboardImages.isDefault, true),
          ),
        )
        .limit(1);

      promptIdToUse = defaultWhiteboard?.promptId || undefined;
    } else if (input.promptId) {
      const [prompt] = await ctx.db
        .select({ id: whiteboardPrompts.id })
        .from(whiteboardPrompts)
        .where(
          and(
            eq(whiteboardPrompts.id, input.promptId),
            eq(whiteboardPrompts.userId, userId),
          ),
        )
        .limit(1);

      if (!prompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt template not found",
        });
      }
    }

    // Deduct credit if not using user API
    if (!input.apiConfigId) {
      const [updatedUser] = await ctx.db
        .update(user)
        .set({
          credits: sql`${user.credits} - 1`,
        })
        .where(and(eq(user.id, userId), sql`${user.credits} >= 1`))
        .returning();

      if (!updatedUser) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Insufficient credits. You need at least 1 credit.",
        });
      }

      // Record credit transaction
      await ctx.db.insert(creditTransactions).values({
        userId: userId,
        amount: -1,
        type: "consume",
        relatedPaperId: input.paperId,
        description: "Whiteboard regeneration",
      });
    }

    // Push to queue for processing
    try {
      await ctx.env.PAPER_QUEUE.send({
        type: "regenerate_whiteboard",
        paperId: input.paperId,
        userId: userId,
        promptId: promptIdToUse,
        apiConfigId: input.apiConfigId,
      });
    } catch (error) {
      // Refund credit if queue dispatch fails
      if (!input.apiConfigId) {
        await ctx.db
          .update(user)
          .set({
            credits: sql`${user.credits} + 1`,
          })
          .where(eq(user.id, userId));

        await ctx.db.insert(creditTransactions).values({
          userId: userId,
          amount: 1,
          type: "refund",
          relatedPaperId: input.paperId,
          description: "Whiteboard regeneration failed - queue dispatch error",
        });
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to queue whiteboard regeneration",
        cause: error,
      });
    }

    return { success: true };
  }),
```

- [ ] **Step 2: Commit regenerateWhiteboard**

```bash
git add src/integrations/trpc/routers/paper.ts
git commit -m "feat(api): add regenerateWhiteboard endpoint"
```

## Chunk 5: Queue Consumer - Handle Regeneration

### Task 6: Update Queue Message Type

**Files:**
- Modify: `src/workers/queue-consumer.ts`

- [ ] **Step 1: Update QueueMessage interface**

Update the interface to support regeneration:

```typescript
interface QueueMessage {
  type?: "initial" | "regenerate_whiteboard";  // Add type field
  paperId: string;
  userId: string;
  sourceType?: "upload" | "arxiv";  // Make optional for regeneration
  arxivUrl?: string;
  r2Key?: string;
  language?: "en" | "zh-cn" | "zh-tw" | "ja";
  whiteboardLanguage?: "en" | "zh-cn" | "zh-tw" | "ja";
  apiConfigId?: string;
  promptId?: string;
}
```

- [ ] **Step 2: Update queue handler to route by type**

Modify the `queue` function to handle different message types:

```typescript
export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { paperId, type = "initial" } = message.body;
      const attempt = message.attempts;

      try {
        console.log(
          `[paper:${paperId}][${type}] Processing attempt ${attempt}/${MAX_RETRIES}`,
        );

        if (type === "regenerate_whiteboard") {
          await processWhiteboardRegeneration(message.body, env);
        } else {
          await processPaper(message.body, env);
        }

        message.ack();
      } catch (error) {
        // ... existing error handling
      }
    }
  },
};
```

- [ ] **Step 3: Commit queue message type update**

```bash
git add src/workers/queue-consumer.ts
git commit -m "feat(queue): add regenerate_whiteboard message type"
```

### Task 7: Implement Whiteboard Regeneration Handler

**Files:**
- Modify: `src/workers/queue-consumer.ts`

- [ ] **Step 1: Add processWhiteboardRegeneration function**

Add before the `processPaper` function:

```typescript
async function processWhiteboardRegeneration(
  msg: QueueMessage,
  env: Env,
): Promise<void> {
  const db = drizzle(env.DB);
  const log = (step: string, message: string) =>
    console.log(`[paper:${msg.paperId}][regenerate][${step}] ${message}`);

  try {
    // Get AI config
    const aiConfig = await getAIConfig(msg.apiConfigId, msg.userId, db, env);

    // Get paper results for insights
    const [result] = await db
      .select()
      .from(paperResults)
      .where(eq(paperResults.paperId, msg.paperId))
      .limit(1);

    if (!result) {
      throw new Error("Paper results not found");
    }

    log("insights", "Retrieved whiteboard insights");

    // Get prompt template
    let promptTemplate: string | undefined;
    if (msg.promptId) {
      const [prompt] = await db
        .select()
        .from(whiteboardPrompts)
        .where(eq(whiteboardPrompts.id, msg.promptId))
        .limit(1);

      if (prompt) {
        promptTemplate = prompt.promptTemplate;
        log("prompt", `Using custom prompt: ${prompt.name}`);
      }
    }

    // Generate whiteboard image
    log("generate", "Generating whiteboard image");
    const imageBuffer = await generateWhiteboardImage(
      result.whiteboardInsights,
      msg.whiteboardLanguage || "en",
      aiConfig,
      promptTemplate,
    );

    // Upload to R2
    const imageKey = `whiteboards/${msg.paperId}/${crypto.randomUUID()}.png`;
    await env.R2_BUCKET.put(imageKey, imageBuffer, {
      httpMetadata: {
        contentType: "image/png",
      },
    });
    log("upload", `Uploaded to R2: ${imageKey}`);

    // Set all existing whiteboards to non-default
    await db
      .update(whiteboardImages)
      .set({ isDefault: false })
      .where(eq(whiteboardImages.paperId, msg.paperId));

    // Create new whiteboard image record
    await db.insert(whiteboardImages).values({
      paperId: msg.paperId,
      imageR2Key: imageKey,
      promptId: msg.promptId || null,
      isDefault: true,
      createdAt: new Date(),
    });

    log("complete", "Whiteboard regeneration completed");

    // Notify via SSE
    await notifyPaperUpdate(msg.userId, msg.paperId, env);
  } catch (error) {
    console.error(
      `[paper:${msg.paperId}][regenerate] Failed:`,
      error,
    );

    // Refund credit if not using user API
    if (!msg.apiConfigId) {
      await db
        .update(user)
        .set({
          credits: sql`${user.credits} + 1`,
        })
        .where(eq(user.id, msg.userId));

      await db.insert(creditTransactions).values({
        userId: msg.userId,
        amount: 1,
        type: "refund",
        relatedPaperId: msg.paperId,
        description: `Whiteboard regeneration failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }

    throw error;
  }
}
```

- [ ] **Step 2: Add helper function for AI config**

Add this helper function after `processWhiteboardRegeneration`:

```typescript
async function getAIConfig(
  apiConfigId: string | undefined,
  userId: string,
  db: ReturnType<typeof drizzle>,
  env: Env,
): Promise<AIConfig> {
  if (apiConfigId) {
    const [config] = await db
      .select()
      .from(userApiConfigs)
      .where(eq(userApiConfigs.id, apiConfigId))
      .limit(1);

    if (!config) {
      throw new Error("API configuration not found");
    }

    return {
      openaiApiKey: decrypt(config.openaiApiKey, env.ENCRYPTION_KEY),
      openaiBaseUrl: config.openaiBaseUrl,
      openaiModel: config.openaiModel,
      geminiApiKey: decrypt(config.geminiApiKey, env.ENCRYPTION_KEY),
      geminiBaseUrl: config.geminiBaseUrl,
      geminiModel: config.geminiModel,
      cfApiToken: env.CF_API_TOKEN,
    };
  }

  return {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL,
    openaiModel: env.OPENAI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiBaseUrl: env.GEMINI_BASE_URL,
    geminiModel: env.GEMINI_MODEL,
    cfApiToken: env.CF_API_TOKEN,
  };
}
```

- [ ] **Step 3: Add SSE notification helper**

Add this helper function:

```typescript
async function notifyPaperUpdate(
  userId: string,
  paperId: string,
  env: Env,
): Promise<void> {
  try {
    const sseUrl = `${env.SSE_BASE_URL || ""}/api/sse/notify`;
    await fetch(sseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        event: "paper_updated",
        data: { paperId },
      }),
    });
  } catch (error) {
    console.error("Failed to send SSE notification:", error);
    // Don't throw - notification failure shouldn't fail the whole process
  }
}
```

- [ ] **Step 4: Import whiteboardImages**

Add to imports at the top:

```typescript
import {
  creditTransactions,
  paperResults,
  papers,
  user,
  userApiConfigs,
  whiteboardPrompts,
  whiteboardImages,  // Add this
} from "#/db/schema";
```

- [ ] **Step 5: Commit queue regeneration handler**

```bash
git add src/workers/queue-consumer.ts
git commit -m "feat(queue): implement whiteboard regeneration handler"
```

### Task 8: Update Initial Paper Processing

**Files:**
- Modify: `src/workers/queue-consumer.ts`

- [ ] **Step 1: Update processPaper to save to whiteboardImages**

Find the section in `processPaper` where whiteboard image is saved (around line 200-250). Replace the code that saves to `paperResults` with code that creates a `whiteboardImages` record:

```typescript
// After uploading whiteboard image to R2, replace:
// OLD CODE (remove this):
// await db.insert(paperResults).values({
//   paperId: msg.paperId,
//   summaries: { [summaryLanguage]: summary },
//   summaryLanguage: summaryLanguage,
//   whiteboardInsights: whiteboardInsights,
//   whiteboardImageR2Key: whiteboardImageKey,
//   imagePrompt: whiteboardPrompt,
//   processingTimeMs: processingTime,
// });

// NEW CODE (add this):
await db.insert(paperResults).values({
  paperId: msg.paperId,
  summaries: { [summaryLanguage]: summary },
  summaryLanguage: summaryLanguage,
  whiteboardInsights: whiteboardInsights,
  processingTimeMs: processingTime,
});

// Create whiteboard image record
await db.insert(whiteboardImages).values({
  paperId: msg.paperId,
  imageR2Key: whiteboardImageKey,
  promptId: msg.promptId || null,
  isDefault: true,
  createdAt: new Date(),
});
```

- [ ] **Step 2: Commit processPaper update**

```bash
git add src/workers/queue-consumer.ts
git commit -m "fix(queue): save whiteboard to whiteboardImages table"
```

## Chunk 6: Frontend - Whiteboard Gallery Dialog

### Task 9: Create Whiteboard Gallery Component

**Files:**
- Create: `src/components/papers/whiteboard-gallery-dialog.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

interface WhiteboardGalleryDialogProps {
  paperId: string;
  whiteboards: Array<{
    id: string;
    imageR2Key: string;
    promptId: string | null;
    promptName: string | null;
    isDefault: boolean;
    createdAt: Date;
  }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhiteboardGalleryDialog({
  paperId,
  whiteboards,
  open,
  onOpenChange,
}: WhiteboardGalleryDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const setDefaultMutation = useMutation(
    trpc.paper.setDefaultWhiteboard.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getById.queryKey(paperId),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.paper.listWhiteboards.queryKey(paperId),
        });
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.paper.deleteWhiteboard.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getById.queryKey(paperId),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.paper.listWhiteboards.queryKey(paperId),
        });
        setDeleteConfirmId(null);
      },
    }),
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {m.paper_whiteboard_gallery_title()}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            {whiteboards.map((whiteboard) => (
              <div
                key={whiteboard.id}
                className="paper-card p-3 space-y-3"
              >
                <button
                  type="button"
                  onClick={() =>
                    setPreviewImage(`/api/r2/${whiteboard.imageR2Key}`)
                  }
                  className="relative w-full aspect-video rounded-lg overflow-hidden border border-[var(--line)] hover:border-[var(--academic-brown)]/30 transition"
                >
                  <img
                    src={`/api/r2/${whiteboard.imageR2Key}`}
                    alt="Whiteboard"
                    className="w-full h-full object-contain bg-[var(--parchment-warm)]"
                  />
                  {whiteboard.isDefault && (
                    <Badge className="absolute top-2 right-2 bg-[var(--academic-brown)] text-white">
                      {m.paper_whiteboard_default()}
                    </Badge>
                  )}
                </button>

                <div className="space-y-2">
                  <div className="text-xs text-[var(--ink-soft)]">
                    {new Date(whiteboard.createdAt).toLocaleString()}
                  </div>
                  {whiteboard.promptName && (
                    <div className="text-xs text-[var(--ink)]">
                      {m.paper_whiteboard_prompt()}: {whiteboard.promptName}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  {!whiteboard.isDefault && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDefaultMutation.mutate({
                          paperId,
                          whiteboardId: whiteboard.id,
                        })
                      }
                      disabled={setDefaultMutation.isPending}
                      className="flex-1"
                    >
                      <Star className="h-3 w-3 mr-1" />
                      {m.paper_whiteboard_set_default()}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className={whiteboard.isDefault ? "flex-1" : ""}
                  >
                    <a
                      href={`/api/r2/${whiteboard.imageR2Key}`}
                      download
                    >
                      <Download className="h-3 w-3 mr-1" />
                      {m.paper_whiteboard_download()}
                    </a>
                  </Button>
                  {whiteboards.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteConfirmId(whiteboard.id)}
                      disabled={deleteMutation.isPending}
                      className="text-[var(--sienna)]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog
        open={!!previewImage}
        onOpenChange={(open) => !open && setPreviewImage(null)}
      >
        <DialogContent className="max-w-[95vw] max-h-[95vh]">
          <img
            src={previewImage || ""}
            alt="Preview"
            className="w-full h-full object-contain"
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {m.paper_whiteboard_delete_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.paper_whiteboard_delete_confirm_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.cancel()}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteConfirmId) {
                  deleteMutation.mutate({
                    paperId,
                    whiteboardId: deleteConfirmId,
                  });
                }
              }}
              className="bg-[var(--sienna)] hover:bg-[var(--sienna)]/90"
            >
              {m.paper_whiteboard_delete()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 2: Commit whiteboard gallery component**

```bash
git add src/components/papers/whiteboard-gallery-dialog.tsx
git commit -m "feat(ui): add whiteboard gallery dialog component"
```


### Task 10: Create Regenerate Dialog Component

**Files:**
- Create: `src/components/papers/regenerate-whiteboard-dialog.tsx`

- [ ] **Step 1: Write regenerate dialog component**

Create the component file with form for regeneration options.

- [ ] **Step 2: Commit regenerate dialog**

```bash
git add src/components/papers/regenerate-whiteboard-dialog.tsx
git commit -m "feat(ui): add regenerate whiteboard dialog component"
```

## Chunk 7: Frontend - Integrate Components

### Task 11: Update Paper Detail Page

**Files:**
- Modify: `src/routes/papers/$paperId.tsx`

- [ ] **Step 1: Import new components**

Add imports at the top:

```typescript
import { WhiteboardGalleryDialog } from "#/components/papers/whiteboard-gallery-dialog";
import { RegenerateWhiteboardDialog } from "#/components/papers/regenerate-whiteboard-dialog";
```

- [ ] **Step 2: Add state for dialogs**

Add state hooks after existing useState declarations:

```typescript
const [isGalleryOpen, setIsGalleryOpen] = useState(false);
const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);
```

- [ ] **Step 3: Update whiteboard display section**

Replace the whiteboard card section with updated version that includes new buttons.

- [ ] **Step 4: Add dialog components**

Add before the closing main tag:

```typescript
{data?.whiteboards && data.whiteboards.length > 0 && (
  <>
    <WhiteboardGalleryDialog
      paperId={paperId}
      whiteboards={data.whiteboards}
      open={isGalleryOpen}
      onOpenChange={setIsGalleryOpen}
    />
    <RegenerateWhiteboardDialog
      paperId={paperId}
      open={isRegenerateOpen}
      onOpenChange={setIsRegenerateOpen}
    />
  </>
)}
```

- [ ] **Step 5: Update whiteboard image URL**

Replace references to `result?.whiteboardImageR2Key` with `result?.defaultWhiteboard?.imageR2Key`.

- [ ] **Step 6: Commit paper detail page updates**

```bash
git add src/routes/papers/$paperId.tsx
git commit -m "feat(ui): integrate whiteboard gallery and regenerate dialogs"
```

### Task 12: Add i18n Messages

**Files:**
- Create: `messages/en.json` (add new keys)
- Create: `messages/zh-CN.json` (add new keys)
- Create: `messages/zh-TW.json` (add new keys)
- Create: `messages/ja.json` (add new keys)

- [ ] **Step 1: Add English messages**

Add to `messages/en.json`:

```json
{
  "paper_whiteboard_gallery_title": "Whiteboard Gallery",
  "paper_whiteboard_default": "Default",
  "paper_whiteboard_prompt": "Prompt",
  "paper_whiteboard_set_default": "Set as Default",
  "paper_whiteboard_delete": "Delete",
  "paper_whiteboard_delete_confirm_title": "Delete Whiteboard?",
  "paper_whiteboard_delete_confirm_description": "This action cannot be undone.",
  "paper_whiteboard_view_all": "View All ({count})",
  "paper_whiteboard_regenerate": "Regenerate",
  "paper_whiteboard_regenerate_title": "Regenerate Whiteboard",
  "paper_whiteboard_regenerate_prompt_label": "Prompt Template",
  "paper_whiteboard_regenerate_use_same": "Use same prompt",
  "paper_whiteboard_regenerate_api_label": "API Configuration",
  "paper_whiteboard_regenerate_api_system": "System API",
  "paper_whiteboard_regenerate_credit_cost": "Will consume 1 credit",
  "paper_whiteboard_regenerate_no_credit_cost": "Using your API, no credit cost",
  "paper_whiteboard_regenerate_submit": "Generate New Whiteboard",
  "paper_whiteboard_regenerating": "Generating..."
}
```

- [ ] **Step 2: Add Chinese (Simplified) messages**

Add corresponding translations to `messages/zh-CN.json`.

- [ ] **Step 3: Add Chinese (Traditional) messages**

Add corresponding translations to `messages/zh-TW.json`.

- [ ] **Step 4: Add Japanese messages**

Add corresponding translations to `messages/ja.json`.

- [ ] **Step 5: Run paraglide compile**

```bash
npm run paraglide:compile
```

Expected: New message functions generated

- [ ] **Step 6: Commit i18n messages**

```bash
git add messages/*.json src/paraglide/
git commit -m "feat(i18n): add whiteboard gallery messages"
```

## Chunk 8: Testing and Deployment

### Task 13: Manual Testing

**Files:**
- None (testing only)

- [ ] **Step 1: Test database migration**

```bash
npm run db:migrate
```

Expected: Migration runs successfully, check D1 console for new table

- [ ] **Step 2: Test listing whiteboards**

Navigate to a completed paper, verify whiteboard displays correctly.

- [ ] **Step 3: Test regenerating whiteboard**

Click regenerate button, select options, verify new whiteboard is generated.

- [ ] **Step 4: Test setting default**

Open gallery, set a different whiteboard as default, verify it updates.

- [ ] **Step 5: Test deleting whiteboard**

Delete a non-default whiteboard, verify it's removed from gallery.

- [ ] **Step 6: Test deleting default whiteboard**

Delete the default whiteboard, verify another is automatically set as default.

- [ ] **Step 7: Test credit deduction**

Regenerate using system API, verify credit is deducted.

- [ ] **Step 8: Test user API**

Regenerate using user API config, verify no credit deduction.

### Task 14: Deploy to Production

**Files:**
- None (deployment only)

- [ ] **Step 1: Run database migration on production**

```bash
npx wrangler d1 migrations apply picx-db --remote
```

Expected: Migration applied successfully

- [ ] **Step 2: Deploy application**

```bash
npm run deploy
```

Expected: Deployment successful

- [ ] **Step 3: Verify production**

Test key flows on production environment.

- [ ] **Step 4: Monitor for errors**

Check logs for any errors in first hour after deployment.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "chore: complete multiple whiteboard images feature"
git push
```

---

## Implementation Notes

### D1 Limitations

- D1 does not support transactions
- All operations must be idempotent where possible
- Use conditional updates for credit deduction

### Error Handling

- Always refund credits on failure if using system API
- Log all errors with paper ID for debugging
- Use SSE to notify frontend of completion/failure

### Performance Considerations

- Index on `paperId` for fast whiteboard lookups
- Composite index on `paperId + isDefault` for default lookup
- Lazy load whiteboard images in gallery

### Security

- Always verify paper ownership before mutations
- Validate prompt and API config ownership
- Check paper completion status before regeneration

