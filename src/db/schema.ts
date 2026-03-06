import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ============================================
// Better Auth Tables
// ============================================

// User table - managed by Better Auth
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified"),
  image: text("image"),
  credits: integer("credits").notNull().default(10),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

// Account table - stores OAuth provider connections
export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", {
    mode: "timestamp_ms",
  }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp_ms",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

// Session table - stores user sessions
export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// Verification table - for email verification tokens
export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
});

// ============================================
// Application Tables
// ============================================

// 论文表
export const papers = sqliteTable(
  "papers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceType: text("source_type", { enum: ["upload", "arxiv"] }).notNull(),
    sourceUrl: text("source_url"),
    pdfR2Key: text("pdf_r2_key").notNull(),
    fileSize: integer("file_size").notNull(),
    pageCount: integer("page_count"),
    status: text("status", {
      enum: [
        "pending",
        "processing_text",
        "processing_image",
        "completed",
        "failed",
      ],
    })
      .notNull()
      .default("pending"),
    errorMessage: text("error_message"),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("papers_user_id_idx").on(
      table.userId,
      table.deletedAt,
      table.createdAt,
    ),
    statusIdx: index("papers_status_idx").on(table.status, table.deletedAt),
  }),
);

// 论文结果表
export const paperResults = sqliteTable(
  "paper_results",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    // 存储多语言摘要的 JSON 对象: { "en": "...", "zh": "...", ... }
    summaries: text("summaries", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
    summaryLanguage: text("summary_language").notNull().default("en"),
    whiteboardStructure: text("whiteboard_structure").notNull(),
    whiteboardImageR2Key: text("whiteboard_image_r2_key"),
    imagePrompt: text("image_prompt").notNull(),
    processingTimeMs: integer("processing_time_ms"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    paperIdIdx: index("paper_results_paper_id_idx").on(table.paperId),
  }),
);

// 积分交易表
export const creditTransactions = sqliteTable(
  "credit_transactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    type: text("type", {
      enum: ["initial", "consume", "refund", "purchase", "daily_bonus"],
    }).notNull(),
    relatedPaperId: text("related_paper_id").references(() => papers.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("credit_transactions_user_id_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);
