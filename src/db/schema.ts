import {
	index,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const todos = pgTable("todos", {
	id: serial().primaryKey(),
	title: text().notNull(),
	createdAt: timestamp("created_at").defaultNow(),
});

// Better Auth will create the users table, we define it here for reference
export const users = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull(),
	emailVerified: timestamp("emailVerified", { mode: "date" }),
	image: text("image"),
	createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});

// 论文表
export const papers = pgTable(
	"papers",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
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
		deletedAt: timestamp("deleted_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
export const paperResults = pgTable("paper_results", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	paperId: text("paper_id")
		.notNull()
		.references(() => papers.id),
	summary: text("summary").notNull(),
	mindmapStructure: text("mindmap_structure").notNull(), // JSON string
	mindmapImageR2Key: text("mindmap_image_r2_key"),
	imagePrompt: text("image_prompt").notNull(),
	processingTimeMs: integer("processing_time_ms"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 积分交易表
export const creditTransactions = pgTable(
	"credit_transactions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		amount: integer("amount").notNull(),
		type: text("type", {
			enum: ["initial", "consume", "refund", "purchase"],
		}).notNull(),
		relatedPaperId: text("related_paper_id").references(() => papers.id),
		description: text("description").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		userIdIdx: index("credit_transactions_user_id_idx").on(
			table.userId,
			table.createdAt,
		),
	}),
);
