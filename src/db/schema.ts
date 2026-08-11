import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  primaryKey,
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
  // better-auth admin plugin 的 schema 列（Phase 3 管理页）。ban/impersonate 本期
  // 不接 UI，但列是插件 schema 的一部分，缺列会在插件运行时报错，一次补齐。
  // 列名 camelCase 与 better-auth 既有列（emailVerified 等）一致。
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }),
  banReason: text("banReason"),
  banExpires: integer("banExpires", { mode: "timestamp_ms" }),
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
  impersonatedBy: text("impersonatedBy"),
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
    // MinerU 解析批次 id。提交后立即落库，作为队列消息重投时防重复提交的幂等守卫。
    mineruBatchId: text("mineru_batch_id"),
    // HuggingFace Daily Papers 的 upvotes，由 arxiv-cron 落库，供 X bot 阈值筛选。
    // 用户上传 / 历史论文为 NULL（不会被 bot 选中，符合防洪）。
    upvotes: integer("upvotes"),
    // 方向挖掘入库的论文归属方向；HF 爆款兜底与历史论文为 NULL
    directionId: text("direction_id").references(() => directions.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: [
        "pending",
        "parsing",
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
    // 可空: whiteboard 变为可选后，未生成白板的论文为 NULL；事后补生成时回填。
    whiteboardInsights: text("whiteboard_insights"),
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

// 论文原文内容（MinerU 解析产物）。与 papers 1:1；只有 MinerU 成功才有行，
// pdfjs 回退的论文没有行 —— 前端据此判断「原文阅读」是否可用。
export const paperContents = sqliteTable("paper_contents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  paperId: text("paper_id")
    .notNull()
    .unique()
    .references(() => papers.id, { onDelete: "cascade" }),
  markdownR2Key: text("markdown_r2_key").notNull(),
  source: text("source", { enum: ["mineru"] })
    .notNull()
    .default("mineru"),
  imageCount: integer("image_count").notNull().default(0),
  charCount: integer("char_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

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
  fromDriver: (value) => {
    // 防御：D1 目前返回 number[]，但官方文档口径是 ArrayBuffer（workers-sdk#8642），两者都兼容
    const raw = value as unknown;
    const bytes =
      raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : ArrayBuffer.isView(raw)
          ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          : new Uint8Array(raw as number[]);
    if (bytes.byteLength % 4 !== 0) {
      throw new Error(`float32Blob: invalid byte length ${bytes.byteLength}`);
    }
    return new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 4,
    );
  },
});

// rss/rsshub: { url } 或 { route }；hn: { queries, minPoints }
// isTweet: rsshub 路由是否为推文源（标题截短 + extra.isTweet 标记）；博客类路由不设
// titleClean: 标题清洗策略；"scraped-research" = 社区抓取镜像的「日期+分类+描述」拼接标题
export type NewsSourceConfig = {
  url?: string;
  route?: string;
  queries?: string[];
  minPoints?: number;
  isTweet?: boolean;
  titleClean?: "scraped-research";
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

// 注意：不要硬删来源（news_items.source_id 级联删除会连带删条目、留下悬空的 story 统计），用 enabled=false 停用。
export const newsSources = sqliteTable("news_sources", {
  // 种子数据用可读固定 id（如 "src-openai-blog"），便于 INSERT OR IGNORE 幂等 seed
  id: text("id").primaryKey(),
  type: text("type", { enum: ["rss", "rsshub", "hn"] }).notNull(),
  name: text("name").notNull(),
  config: text("config", { mode: "json" }).notNull().$type<NewsSourceConfig>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // 最后一次「成功」抓取的时间——失败不更新，是来源新鲜度的真实口径
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
  // 最后一次「尝试」抓取的时间，成功与失败都写。熔断后的指数退避探活按它计时：
  // 复用 lastFetchedAt 会因失败不更新而每轮都探活，冷却形同虚设。
  lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
  lastError: text("last_error"),
  // 连续失败达到阈值自动熔断（enabled=false），之后转入指数退避探活自愈，见 lib/news/source-health.ts。
  // 注意：「人为停用」与「故障熔断」共用 enabled 这一位，靠本列区分——
  // 想永久停用一个源，请保证 consecutive_failures 为 0，否则会被探活重新唤醒。
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// 注意：不要硬删 story（news_items.story_id 置 NULL 后条目会卡在 clustered 状态），用 status='hidden' 下架；无成员的孤儿 story 由管道清理。
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
    // 四语事实要点 Record<localeKey, string[]>（key 同 title/summary：en/zh-cn/zh-tw/ja）；
    // null = 尚未生成——summarize 的回填选路按 key_facts IS NULL 挑存量行
    keyFacts: text("key_facts", { mode: "json" }).$type<
      Record<string, string[]>
    >(),
    // 相关资讯 shortId 数组（最多 4 个）：自身重算时按相似度降序，反向补写插头部（非严格降序）；读取侧还要过滤 hidden
    related: text("related", { mode: "json" }).$type<string[]>(),
    // 头条封面图：summarize 阶段从成员 media 预计算，列表查询免 N+1
    leadImage: text("lead_image", { mode: "json" }).$type<NewsMedia | null>(),
    // 有新成员并入置真，summarize 阶段处理完置假——崩溃可恢复的幂等标记（D1 无事务）
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(true),
    // story 首次聚合时间；展示与「最新」排序改用 earliestPublishedAt 后作为回退值（与 created_at 同刻，语义独立保留）
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" }).notNull(),
    // 成员条目最早的 publishedAt —— 对外展示与 feed「最新」排序的时间口径
    // （firstSeenAt 是收录时间，回填/补抓时会晚于新闻实际时间）。
    // SQLite ALTER 无法补 NOT NULL，列保持 nullable；写入路径（cluster/summarize）始终赋值，读取处回退 firstSeenAt
    earliestPublishedAt: integer("earliest_published_at", {
      mode: "timestamp",
    }),
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
    // 注意：partial index 只匹配字面量谓词。查询必须写 sql`... != 'hidden'` / sql`... = 1`，
    // 用 drizzle 的 ne()/eq()（绑定参数）会静默退化为全表扫描。下面两组 partial index 均适用。
    // feed 列表：status != 'hidden' + 时间倒序，用 partial index 才能走索引免排序
    feedPublishedIdx: index("news_stories_feed_published_idx")
      .on(table.earliestPublishedAt)
      .where(sql`${table.status} != 'hidden'`),
    feedActiveIdx: index("news_stories_feed_active_idx")
      .on(table.lastActivityAt)
      .where(sql`${table.status} != 'hidden'`),
    // 聚类窗口：status = 'active' AND last_activity_at > cutoff
    statusActivityIdx: index("news_stories_status_activity_idx").on(
      table.status,
      table.lastActivityAt,
    ),
    // summarize 扫描：dirty 行远少于总量，partial 更小
    dirtyIdx: index("news_stories_dirty_idx")
      .on(table.dirty)
      .where(sql`${table.dirty} = 1`),
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
    // LLM 相关性×质量分，0-100 整数（低于阈值 status='rejected'）
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

// ============================================
// Paper Chat Tables
// ============================================

// 论文对话会话：每用户每论文可开多个会话，永久保留
export const chatSessions = sqliteTable(
  "chat_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    // 首条用户消息截断而来；新建未发言时为 NULL
    title: text("title"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userPaperIdx: index("chat_sessions_user_paper_idx").on(
      table.userId,
      table.paperId,
      table.updatedAt,
    ),
  }),
);

// 对话消息：parts 存 AI SDK UIMessage 的 parts 数组（与 @cloudflare/ai-chat /
// Think 同格式，保留将来迁移 Think 的路径，勿改成纯文本列）。
// user_id 冗余存储：限流按 (user_id, role, created_at) 直查，免 join。
export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    parts: text("parts", { mode: "json" }).notNull().$type<unknown[]>(),
    // 毫秒精度（有意区别于其他表的秒级 timestamp）：同一秒内连续插入的
    // user/assistant 消息需靠 created_at 保证排序，且限流窗口直接用毫秒比较
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    sessionIdx: index("chat_messages_session_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    userRateIdx: index("chat_messages_user_rate_idx").on(
      table.userId,
      table.role,
      table.createdAt,
    ),
  }),
);

// ============================================
// Assistant Agent Tables
// conversations 按未来群聊 channel 的形状设计：type/成员表/senderId 均为预留，
// 本期只用 type='agent'（单人会话 = 恰好一行 owner 成员）。
// ============================================

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    type: text("type", { enum: ["agent", "channel"] })
      .notNull()
      .default("agent"),
    // 首条用户消息截断而来；新建未发言时为 NULL（同 chat_sessions.title 约定）
    title: text("title"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    createdByIdx: index("conversations_created_by_idx").on(
      table.createdBy,
      table.updatedAt,
    ),
  }),
);

export const conversationMembers = sqliteTable(
  "conversation_members",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("owner"),
    joinedAt: integer("joined_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conversationId, table.userId] }),
    // 「我的会话列表」按成员反查
    userIdx: index("conversation_members_user_idx").on(table.userId),
  }),
);

// parts 存 AI SDK UIMessage parts（同 chat_messages 约定）。
// sender_id 冗余用于限流直查；assistant 消息 sender_id = NULL。
export const conversationMessages = sqliteTable(
  "conversation_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderType: text("sender_type", { enum: ["user", "assistant"] }).notNull(),
    senderId: text("sender_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    parts: text("parts", { mode: "json" }).notNull().$type<unknown[]>(),
    // 毫秒精度：同 chat_messages，排序与限流窗口都靠它
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    conversationIdx: index("conversation_messages_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    senderRateIdx: index("conversation_messages_sender_rate_idx").on(
      table.senderId,
      table.senderType,
      table.createdAt,
    ),
  }),
);

// 个人档案：用户可见可编辑，agent 通过 updateProfile 工具写同一行
export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ==================== Gallery 方向化（direction digest）====================

/** direction_sources.config 的形状，按 adapterType 取用对应字段 */
export type DirectionSourceConfig = {
  /** arxiv_query: arXiv API search_query 表达式 */
  query?: string;
  maxResults?: number;
  /** rss: feed 地址 */
  url?: string;
};

export const directions = sqliteTable("directions", {
  // 种子数据用可读固定 id（如 "dir-ai4formath"），便于 INSERT OR IGNORE 幂等 seed
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name", { mode: "json" })
    .notNull()
    .$type<Record<string, string>>(),
  // 当前关注的小方向 + 口味描述，直接喂给 LLM；小方向流变 = 改这段文字
  focusBrief: text("focus_brief").notNull(),
  // 四语公开简介（公开页展示用）；NULL 时公开查询回退 focusBrief 中文原文。
  // focusBrief 本身保持单语中文（喂 LLM 的内部口味描述），不对外。
  intro: text("intro", { mode: "json" }).$type<Record<string, string>>(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const directionSources = sqliteTable(
  "direction_sources",
  {
    // 可读固定 id（如 "dsrc-ai4formath-arxiv-atp"）只是 seed 脚本的约定；
    // 管理页运行时创建的源走 "dsrc-{随机 8 位}"（见 lib/digest/admin-store.ts）
    id: text("id").primaryKey(),
    directionId: text("direction_id")
      .notNull()
      .references(() => directions.id, { onDelete: "cascade" }),
    // Zulip 适配器本期不做（匿名 API 401，需 bot 凭据）；届时加 enum 值即可，
    // SQLite 侧 enum 只是 drizzle 类型标注，不生成 CHECK 约束，无需迁移
    adapterType: text("adapter_type", {
      enum: ["arxiv_query", "rss"],
    }).notNull(),
    config: text("config", { mode: "json" })
      .notNull()
      .$type<DirectionSourceConfig>(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // 熔断字段与 news_sources 同构，复用 #/lib/news/source-health
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    directionIdx: index("direction_sources_direction_idx").on(
      table.directionId,
    ),
  }),
);

export const digests = sqliteTable(
  "digests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    directionId: text("direction_id")
      .notNull()
      .references(() => directions.id, { onDelete: "cascade" }),
    issueNumber: integer("issue_number").notNull(),
    periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp" }).notNull(),
    status: text("status", { enum: ["generating", "published", "failed"] })
      .notNull()
      .default("generating"),
    title: text("title", { mode: "json" }).$type<Record<string, string>>(),
    // 四语 markdown 正文：本期看点、非论文情报段落、被否决候选附注、open questions
    content: text("content", { mode: "json" }).$type<Record<string, string>>(),
    // LLM 对 focusBrief 的更新提案，Phase 3 管理页人工采纳
    proposedFocusUpdate: text("proposed_focus_update"),
    // 提案审阅状态：无提案为 NULL；saveDigestContent 落非空提案时置 pending，
    // 管理页采纳/驳回翻 adopted/dismissed。采纳链即 focusBrief 演化史，不另建历史表。
    proposedFocusUpdateStatus: text("proposed_focus_update_status", {
      enum: ["pending", "adopted", "dismissed"],
    }),
    // workflow instanceId，step 重试幂等守卫
    workflowInstanceId: text("workflow_instance_id").notNull().unique(),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    issueUnique: uniqueIndex("digests_direction_issue_unique").on(
      table.directionId,
      table.issueNumber,
    ),
    directionPublishedIdx: index("digests_direction_published_idx").on(
      table.directionId,
      table.publishedAt,
    ),
  }),
);

export const digestPapers = sqliteTable(
  "digest_papers",
  {
    digestId: text("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    // 「这篇新在哪、为什么值得读」——某一期的编辑判断，所以放关联表不放 papers
    recommendationNote: text("recommendation_note", { mode: "json" }).$type<
      Record<string, string>
    >(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.digestId, table.paperId] }),
    paperIdx: index("digest_papers_paper_idx").on(table.paperId),
  }),
);

export const directionCandidates = sqliteTable(
  "direction_candidates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    directionId: text("direction_id")
      .notNull()
      .references(() => directions.id, { onDelete: "cascade" }),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["paper", "intel"] })
      .notNull()
      .default("paper"),
    status: text("status", { enum: ["seen", "recommended", "rejected"] })
      .notNull()
      .default("seen"),
    // 最近一次精读评审的综合分 0-100；未评审过为 NULL
    score: integer("score"),
    sourceMeta: text("source_meta", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    urlUnique: uniqueIndex("direction_candidates_url_unique").on(
      table.directionId,
      table.canonicalUrl,
    ),
    statusIdx: index("direction_candidates_status_idx").on(
      table.directionId,
      table.status,
    ),
  }),
);

export const paperFeedback = sqliteTable(
  "paper_feedback",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    vote: integer("vote").notNull(), // 1 | -1
    reasonPreset: text("reason_preset", {
      enum: ["off-topic", "incremental", "hype", "seen", "other"],
    }),
    reasonText: text("reason_text"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    paperUserUnique: uniqueIndex("paper_feedback_paper_user_unique").on(
      table.paperId,
      table.userId,
    ),
  }),
);

export const hfSignals = sqliteTable(
  "hf_signals",
  {
    arxivId: text("arxiv_id").primaryKey(),
    upvotes: integer("upvotes").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD（HF daily 的日期）
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    dateIdx: index("hf_signals_date_idx").on(table.date),
  }),
);
