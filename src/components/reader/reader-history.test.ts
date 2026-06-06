import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteEntry,
  getEntry,
  HISTORY_BUDGET_BYTES,
  hashBytes,
  listEntries,
  mergeEntry,
  type ReaderHistoryEntry,
  type RecordInput,
  recordRead,
  sanitizeEntry,
  selectEvictions,
  utf8Bytes,
} from "./reader-history";

function entry(over: Partial<ReaderHistoryEntry>): ReaderHistoryEntry {
  return {
    id: "id",
    userId: "u1",
    title: "t",
    markdown: "m",
    source: { kind: "upload", name: "a.pdf" },
    createdAt: 1,
    lastReadAt: 1,
    sizeBytes: 1,
    ...over,
  };
}

describe("utf8Bytes", () => {
  it("按 UTF-8 计字节而非字符数", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("中")).toBe(3);
  });
});

describe("hashBytes", () => {
  it("同字节得同 hex,且为 64 位十六进制", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const a = await hashBytes(bytes);
    const b = await hashBytes(new Uint8Array([1, 2, 3]).buffer);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("不同字节得不同 hex", async () => {
    const a = await hashBytes(new Uint8Array([1, 2, 3]).buffer);
    const c = await hashBytes(new Uint8Array([1, 2, 4]).buffer);
    expect(a).not.toBe(c);
  });

  it("接受 Uint8Array 输入", async () => {
    const fromBuffer = await hashBytes(new Uint8Array([9, 8, 7]).buffer);
    const fromView = await hashBytes(new Uint8Array([9, 8, 7]));
    expect(fromView).toBe(fromBuffer);
  });
});

describe("mergeEntry", () => {
  const input: RecordInput = {
    id: "x",
    userId: "u1",
    title: "New Title",
    markdown: "hello",
    source: { kind: "url", name: "p.pdf", url: "https://e/p.pdf" },
    now: 1000,
  };

  it("无 prev 时新建,createdAt=lastReadAt=now,sizeBytes 由 markdown 算", () => {
    const e = mergeEntry(undefined, input);
    expect(e.createdAt).toBe(1000);
    expect(e.lastReadAt).toBe(1000);
    expect(e.sizeBytes).toBe(utf8Bytes("hello"));
    expect(e.id).toBe("x");
  });

  it("有 prev 时保留 createdAt、更新 lastReadAt 与内容", () => {
    const prev = entry({ id: "x", createdAt: 5, lastReadAt: 5, title: "Old" });
    const e = mergeEntry(prev, input);
    expect(e.createdAt).toBe(5);
    expect(e.lastReadAt).toBe(1000);
    expect(e.title).toBe("New Title");
  });
});

describe("selectEvictions", () => {
  it("总量在预算内时不淘汰", () => {
    const list = [entry({ id: "a", sizeBytes: 10, lastReadAt: 1 })];
    expect(selectEvictions(list, 100)).toEqual([]);
  });

  it("超预算时按 lastReadAt 从旧到新淘汰", () => {
    const list = [
      entry({ id: "old", sizeBytes: 60, lastReadAt: 1 }),
      entry({ id: "mid", sizeBytes: 60, lastReadAt: 2 }),
      entry({ id: "new", sizeBytes: 60, lastReadAt: 3 }),
    ];
    // 总 180 → 淘汰 old → 剩 120 > 100 → 淘汰 mid → 剩 60 ≤ 100 → 止
    expect(selectEvictions(list, 100)).toEqual(["old", "mid"]);
  });

  it("始终至少保留最新一条(单篇超预算也不全删)", () => {
    const list = [entry({ id: "only", sizeBytes: 999, lastReadAt: 9 })];
    expect(selectEvictions(list, 100)).toEqual([]);
  });
});

describe("sanitizeEntry", () => {
  it("合法记录原样返回", () => {
    const e = entry({});
    expect(sanitizeEntry(e)).toEqual(e);
  });

  it("缺字段或类型错误返回 null", () => {
    expect(sanitizeEntry(null)).toBeNull();
    expect(sanitizeEntry({ id: "x" })).toBeNull();
    expect(sanitizeEntry({ ...entry({}), sizeBytes: "no" })).toBeNull();
  });

  it("url 来源带 url 时通过", () => {
    const e = entry({
      source: { kind: "url", name: "p.pdf", url: "https://e/p.pdf" },
    });
    expect(sanitizeEntry(e)).toEqual(e);
  });

  it("url 来源缺 url 时返回 null", () => {
    const bad = { ...entry({}), source: { kind: "url", name: "p.pdf" } };
    expect(sanitizeEntry(bad)).toBeNull();
  });
});

it("预算常量为 150MB", () => {
  expect(HISTORY_BUDGET_BYTES).toBe(150 * 1024 * 1024);
});

beforeEach(() => {
  // 每个用例用全新 IDB,隔离结构化而非依赖不同 id。
  globalThis.indexedDB = new IDBFactory();
});

describe("store(fake-indexeddb)", () => {
  function input(over: Partial<RecordInput>): RecordInput {
    return {
      id: "id",
      userId: "u1",
      title: "t",
      markdown: "m",
      source: { kind: "upload", name: "a.pdf" },
      now: 1,
      ...over,
    };
  }

  it("recordRead 落库后能按 userId 列出", async () => {
    await recordRead(input({ id: "a", userId: "u1", now: 10 }));
    const list = await listEntries("u1");
    expect(list.map((e) => e.id)).toContain("a");
  });

  it("listEntries 按 lastReadAt 倒序", async () => {
    await recordRead(input({ id: "x1", userId: "order", now: 1 }));
    await recordRead(input({ id: "x2", userId: "order", now: 3 }));
    await recordRead(input({ id: "x3", userId: "order", now: 2 }));
    const ids = (await listEntries("order")).map((e) => e.id);
    expect(ids).toEqual(["x2", "x3", "x1"]);
  });

  it("按 userId 隔离:只返回本账号", async () => {
    await recordRead(input({ id: "ma", userId: "A", now: 1 }));
    await recordRead(input({ id: "mb", userId: "B", now: 1 }));
    expect((await listEntries("A")).map((e) => e.id)).toEqual(["ma"]);
  });

  it("同 id 重复 record 只更新不新增,且保留 createdAt", async () => {
    await recordRead(input({ id: "dup", userId: "D", title: "Old", now: 5 }));
    await recordRead(input({ id: "dup", userId: "D", title: "New", now: 9 }));
    const list = await listEntries("D");
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("New");
    expect(list[0].createdAt).toBe(5);
    expect(list[0].lastReadAt).toBe(9);
  });

  it("deleteEntry 删除指定记录", async () => {
    await recordRead(input({ id: "del", userId: "X", now: 1 }));
    await deleteEntry("del");
    expect(await getEntry("del")).toBeUndefined();
  });

  it("超预算时旧记录被淘汰", async () => {
    const SMALL_BUDGET = 150;
    const big = "x".repeat(100); // 每篇 100 字节,两篇 200 > 150 预算
    await recordRead(
      input({ id: "old", userId: "E", markdown: big, now: 1 }),
      SMALL_BUDGET,
    );
    await recordRead(
      input({ id: "new", userId: "E", markdown: big, now: 2 }),
      SMALL_BUDGET,
    );
    const ids = (await listEntries("E")).map((e) => e.id);
    expect(ids).toEqual(["new"]);
  });
});
