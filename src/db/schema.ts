import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  lastDailyBonusDate: text("last_daily_bonus_date"),
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
    shortId: text("short_id").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceType: text("source_type", { enum: ["upload", "arxiv"] }).notNull(),
    sourceUrl: text("source_url"),
    pdfR2Key: text("pdf_r2_key").notNull(),
    fileSize: integer("file_size").notNull(),
    pageCount: integer("page_count"),
    // HuggingFace Daily Papers 的 upvotes，由 arxiv-cron 落库，供 X bot 阈值筛选。
    // 用户上传 / 历史论文为 NULL（不会被 bot 选中，符合防洪）。
    upvotes: integer("upvotes"),
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
    whiteboardRegenerating: integer("whiteboard_regenerating", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    isListedInGallery: integer("is_listed_in_gallery", { mode: "boolean" })
      .notNull()
      .default(false),
    publishedAt: integer("published_at", { mode: "timestamp" }),
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
    publicIdx: index("papers_public_idx").on(
      table.isPublic,
      table.isListedInGallery,
      table.publishedAt,
    ),
    shortIdIdx: index("papers_short_id_idx").on(table.shortId),
    // gallery 唯一性(问题②根治): 同一 source_url 在 gallery 集合中至多一行。
    // partial index 只约束 gallery 且未删除的行, 私有论文 / 已删除论文不受限,
    // 可重复。source_url 规范化由写入方(arxiv-cron)保证, 见 lib/arxiv.ts。
    galleryUrlUnique: uniqueIndex("papers_gallery_source_url_unique")
      .on(table.sourceUrl)
      .where(
        sql`${table.isListedInGallery} = 1 and ${table.deletedAt} is null and ${table.sourceUrl} is not null`,
      ),
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
    // 存储多语言摘要的 JSON 对象: { "en": "...", "zh-cn": "...", "zh-tw": "...", "ja": "...", ... }
    summaries: text("summaries", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
    // 存储多语言一句话核心结论(用于 gallery 卡片): { "en": "...", "zh-cn": "...", ... }
    // 可空: 存量数据没有, 读取时从 summaries 兜底
    tldr: text("tldr", { mode: "json" }).$type<Record<string, string>>(),
    // 主分类 slug 数组(固定集合,见 src/lib/paper-categories.ts),如 ["multimodal","vision"]。
    // 可空: 存量为 NULL, 由 backfill 补齐, 读取时当空数组。
    categories: text("categories", { mode: "json" }).$type<string[]>(),
    // LLM 自由细粒度 tag(小写连字符),如 ["image-restoration","diffusion"]。
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    summaryLanguage: text("summary_language").notNull().default("en"),
    whiteboardInsights: text("whiteboard_insights").notNull(),
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

// 用户 API 配置表 (BYOK - Bring Your Own Key)
export const userApiConfigs = sqliteTable(
  "user_api_configs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    openaiApiKey: text("openai_api_key").notNull(),
    openaiBaseUrl: text("openai_base_url").notNull(),
    openaiModel: text("openai_model").notNull(),
    geminiApiKey: text("gemini_api_key").notNull(),
    geminiBaseUrl: text("gemini_base_url").notNull(),
    geminiModel: text("gemini_model").notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    lastTestedAt: integer("last_tested_at", { mode: "timestamp" }),
    openaiTestStatus: text("openai_test_status", {
      enum: ["success", "failed", "untested"],
    }).default("untested"),
    geminiTestStatus: text("gemini_test_status", {
      enum: ["success", "failed", "untested"],
    }).default("untested"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("idx_user_api_configs_user_id").on(table.userId),
    userDefaultIdx: index("idx_user_api_configs_user_default").on(
      table.userId,
      table.isDefault,
    ),
  }),
);

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

// 白板图片表 - 支持每篇论文多张白板图片
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
    paperIdDefaultIdx: index("whiteboard_images_paper_id_default_idx").on(
      table.paperId,
      table.isDefault,
    ),
  }),
);

// X bot 投递记录：每天选出的论文推送到 Telegram 供人工发推。
// 一篇论文最多一行（paper_id 唯一）用于去重，避免重复推送给运营者。
export const tweetQueue = sqliteTable(
  "tweet_queue",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    paperId: text("paper_id")
      .notNull()
      .unique()
      .references(() => papers.id, { onDelete: "cascade" }),
    caption: text("caption").notNull(),
    status: text("status", {
      enum: ["sent", "error"],
    }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    tweetId: text("tweet_id"),
    errorMsg: text("error_msg"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    statusIdx: index("tweet_queue_status_idx").on(table.status),
  }),
);

// ==== News Aggregation Tables ====

// D1 的 BLOB 经 Workers binding 读回是 number[] 而非 ArrayBuffer（drizzle-orm#926），
// 用 customType 统一转换为 Float32Array。写入按社区验证的 number[] 形式。
export const float32Blob = customType<{
  data: Float32Array;
  driverData: number[];
}>({
  dataType: () => "blob",
  toDriver: (value) =>
    Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ),
  fromDriver: (value) => new Float32Array(Uint8Array.from(value).buffer),
});

// rss/rsshub: { url } 或 { route }；hn: { queries, minPoints }
export type NewsSourceConfig = {
  url?: string;
  route?: string;
  queries?: string[];
  minPoints?: number;
};

export type NewsMedia = {
  type: "image" | "video";
  url: string;
  width?: number;
  height?: number;
};

// 按平台分开展示的参考信号（明确不聚合成单一标量、不参与排序）
export type StorySignalsSummary = {
  domains: string[];
  hn?: { points: number; comments: number; url: string };
  xAccounts?: number;
};

export const newsSources = sqliteTable(
  "news_sources",
  {
    // 种子数据用可读固定 id（如 "src-openai-blog"），便于 INSERT OR IGNORE 幂等 seed
    id: text("id").primaryKey(),
    type: text("type", { enum: ["rss", "rsshub", "hn"] }).notNull(),
    name: text("name").notNull(),
    config: text("config", { mode: "json" })
      .notNull()
      .$type<NewsSourceConfig>(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    // 连续失败达到阈值自动禁用，避免死源每小时空转
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    enabledIdx: index("news_sources_enabled_idx").on(table.enabled, table.type),
  }),
);

export const newsStories = sqliteTable(
  "news_stories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    shortId: text("short_id").notNull().unique(),
    // 四语 key: en / zh-cn / zh-tw / ja（与 lib/tldr.ts 的 normalizeLocaleKey 对齐，可复用 pickTldr）
    title: text("title", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
    summary: text("summary", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
    // 不加 FK：与 news_items 互相引用会形成环，迁移与删除都会麻烦
    primaryItemId: text("primary_item_id"),
    centroid: float32Blob("centroid").notNull(),
    itemCount: integer("item_count").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    signalsSummary: text("signals_summary", {
      mode: "json",
    }).$type<StorySignalsSummary>(),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    // 有新成员并入置真，summarize 阶段处理完置假——崩溃可恢复的幂等标记（D1 无事务）
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(true),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" }).notNull(),
    lastActivityAt: integer("last_activity_at", {
      mode: "timestamp",
    }).notNull(),
    status: text("status", { enum: ["active", "archived", "hidden"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    statusFirstSeenIdx: index("news_stories_status_first_seen_idx").on(
      table.status,
      table.firstSeenAt,
    ),
    statusActivityIdx: index("news_stories_status_activity_idx").on(
      table.status,
      table.lastActivityAt,
    ),
    dirtyIdx: index("news_stories_dirty_idx").on(table.dirty),
  }),
);

export const newsItems = sqliteTable(
  "news_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sourceId: text("source_id")
      .notNull()
      .references(() => newsSources.id, { onDelete: "cascade" }),
    // 归一化 URL 的 SHA-256，同一链接被多来源/多账号提及时只保留一行（更新 signals）
    urlHash: text("url_hash").notNull().unique(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    author: text("author"),
    publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    // 平台原生指标（HN: {points, comments}），展示与回刷用，不做跨平台聚合
    signals: text("signals", { mode: "json" }).$type<Record<string, number>>(),
    media: text("media", { mode: "json" }).$type<NewsMedia[]>(),
    // 各来源异构字段兜底（hnId/hnUrl、isTweet 等）
    extra: text("extra", { mode: "json" }).$type<Record<string, unknown>>(),
    relevanceScore: integer("relevance_score"),
    embedding: float32Blob("embedding"),
    storyId: text("story_id").references(() => newsStories.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["pending", "clustered", "rejected"] })
      .notNull()
      .default("pending"),
  },
  (table) => ({
    statusIdx: index("news_items_status_idx").on(table.status, table.fetchedAt),
    storyIdx: index("news_items_story_idx").on(
      table.storyId,
      table.publishedAt,
    ),
    sourceIdx: index("news_items_source_idx").on(
      table.sourceId,
      table.publishedAt,
    ),
  }),
);
