import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const todos = sqliteTable("todos", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	title: text("title").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
});

// Better Auth will create the users table, we define it here for reference
export const users = sqliteTable("users", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("emailVerified", { mode: "timestamp" }),
	image: text("image"),
	credits: integer("credits").notNull().default(10),
	createdAt: integer("createdAt", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer("updatedAt", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
});

// 论文表
export const papers = sqliteTable(
	"papers",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
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
		summary: text("summary").notNull(),
		// Note: SQLite doesn't have a native JSON type, using text to store JSON string
		mindmapStructure: text("mindmap_structure").notNull(), // JSON string
		mindmapImageR2Key: text("mindmap_image_r2_key"),
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
			.references(() => users.id, { onDelete: "restrict" }),
		amount: integer("amount").notNull(),
		type: text("type", {
			enum: ["initial", "consume", "refund", "purchase"],
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
