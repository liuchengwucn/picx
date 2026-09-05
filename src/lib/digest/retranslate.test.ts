// 回填入口的落库语义：只覆盖目标语言那一个键、逐行认 paperId、译文缺条时保留原值。
// 用真 SQLite 回放迁移，因为这些语义全在 JSON 合并与 WHERE 里，mock 链看不见。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { digestPapers, digests, directions, papers, user } from "#/db/schema";
import { createTestDb } from "../../../test/helpers/sqlite-d1";

const translateDigest = vi.hoisted(() => vi.fn());
vi.mock("./ai", () => ({ translateDigest }));

const { resolveDigestRef, retranslateDigestLocale } = await import(
  "./retranslate"
);

type Db = ReturnType<typeof createTestDb>["db"];

const four = (p: string) => ({
  en: `${p} en`,
  "zh-cn": `${p} zh-cn`,
  "zh-tw": `${p} zh-tw`,
  ja: `${p} ja`,
});

// cheapModel 只读这几个键，给假值即可——translateDigest 已被 mock，不会发请求
const env = {
  OPENAI_API_KEY: "k",
  OPENAI_BASE_URL: "",
  OPENAI_MODEL: "m",
  DIGEST_CHEAP_MODEL: "",
  DIGEST_STRONG_MODEL: "",
  CF_API_TOKEN: "",
} as Parameters<typeof retranslateDigestLocale>[1];

async function seed(db: Db) {
  const now = new Date();
  await db
    .insert(user)
    .values({
      id: "u1",
      name: "u1",
      email: "u1@example.com",
      createdAt: now,
      updatedAt: now,
    });
  await db.insert(directions).values({
    id: "dir-a",
    slug: "formal-math",
    name: four("A"),
    focusBrief: "a",
    isActive: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(digests).values({
    id: "dg-1",
    directionId: "dir-a",
    issueNumber: 3,
    periodStart: now,
    periodEnd: now,
    status: "published",
    title: four("T"),
    content: four("BODY"),
    workflowInstanceId: "wf-1",
    publishedAt: now,
  });
  await db.insert(papers).values(
    [1, 2].map((i) => ({
      id: `p${i}`,
      userId: "u1",
      shortId: `s${i}`,
      title: `Paper ${i}`,
      sourceType: "arxiv" as const,
      pdfR2Key: `papers/p${i}.pdf`,
      fileSize: 1,
      status: "completed" as const,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db.insert(digestPapers).values([
    { digestId: "dg-1", paperId: "p1", rank: 1, recommendationNote: four("n1") },
    { digestId: "dg-1", paperId: "p2", rank: 2, recommendationNote: four("n2") },
  ]);
}

describe("retranslateDigestLocale", () => {
  let db: Db;

  beforeEach(async () => {
    translateDigest.mockReset();
    db = createTestDb().db;
    await seed(db);
  });

  it("overwrites only the target locale and leaves the others intact", async () => {
    translateDigest.mockImplementation(async (_cfg, _target, payload) => ({
      title: "新TITLE",
      content: "新BODY",
      notes: Object.fromEntries(
        Object.keys(payload.notes).map((k) => [k, `新note ${k}`]),
      ),
    }));

    const result = await retranslateDigestLocale(db, env, "dg-1", "ja");
    expect(result).toMatchObject({
      slug: "formal-math",
      issueNumber: 3,
      status: "ok",
      written: 4,
    });

    // 源始终是 zh-cn，不是当前（坏掉的）ja
    expect(translateDigest.mock.calls[0][2]).toEqual({
      title: "T zh-cn",
      content: "BODY zh-cn",
      notes: { p1: "n1 zh-cn", p2: "n2 zh-cn" },
    });

    const [row] = await db.select().from(digests);
    expect(row.title).toEqual({ ...four("T"), ja: "新TITLE" });
    expect(row.content).toEqual({ ...four("BODY"), ja: "新BODY" });

    const notes = await db.select().from(digestPapers).orderBy(digestPapers.rank);
    expect(notes[0].recommendationNote).toEqual({
      ...four("n1"),
      ja: "新note p1",
    });
    expect(notes[1].recommendationNote).toEqual({
      ...four("n2"),
      ja: "新note p2",
    });
  });

  it("keeps the old note when the model drops a key", async () => {
    translateDigest.mockResolvedValue({
      title: "新TITLE",
      content: "新BODY",
      notes: { p1: "新note p1" },
    });

    const result = await retranslateDigestLocale(db, env, "dg-1", "ja");
    expect(result.written).toBe(3);
    expect(result.detail).toContain("1 note(s) missing");

    const notes = await db.select().from(digestPapers).orderBy(digestPapers.rank);
    expect(notes[1].recommendationNote).toEqual(four("n2"));
  });

  it("writes nothing on dry run", async () => {
    translateDigest.mockResolvedValue({
      title: "新TITLE",
      content: "新BODY",
      notes: {},
    });

    const result = await retranslateDigestLocale(db, env, "dg-1", "ja", {
      dryRun: true,
    });
    expect(result.written).toBe(0);
    const [row] = await db.select().from(digests);
    expect(row.title).toEqual(four("T"));
  });

  it("reports a missing digest instead of throwing", async () => {
    const result = await retranslateDigestLocale(db, env, "nope", "ja");
    expect(result.status).toBe("failed");
    expect(translateDigest).not.toHaveBeenCalled();
  });

  it("propagates a guard failure so nothing is written", async () => {
    translateDigest.mockRejectedValue(new Error("translate ja: untranslated"));
    await expect(
      retranslateDigestLocale(db, env, "dg-1", "ja"),
    ).rejects.toThrow("untranslated");
    const [row] = await db.select().from(digests);
    expect(row.title).toEqual(four("T"));
  });
});

describe("resolveDigestRef", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb().db;
    await seed(db);
  });

  it("resolves slug#issue", async () => {
    expect(await resolveDigestRef(db, "formal-math#3")).toBe("dg-1");
    expect(await resolveDigestRef(db, "formal-math:3")).toBe("dg-1");
  });

  it("returns null for an unknown coordinate", async () => {
    expect(await resolveDigestRef(db, "formal-math#9")).toBeNull();
    expect(await resolveDigestRef(db, "nosuch#3")).toBeNull();
  });

  it("passes a bare id through untouched", async () => {
    expect(await resolveDigestRef(db, "dg-1")).toBe("dg-1");
  });
});
