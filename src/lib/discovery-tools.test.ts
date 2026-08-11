import { describe, expect, it, vi } from "vitest";
import {
  buildDiscoveryTools,
  DISCOVERY_LIMITS,
  type DiscoveryToolsDeps,
  markInLibrary,
  normalizeArxivIds,
  parseArxivAtom,
} from "#/lib/discovery-tools";

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2601.13209v2</id>
    <title>Test Paper:
      Multi-line Title</title>
    <summary>An abstract with &amp;amp; escaped &amp;lt;chars&amp;gt;.</summary>
    <published>2026-01-20T18:00:00Z</published>
    <author><name>Alice A</name></author>
    <author><name>Bob B</name></author>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v1</id>
    <title>Legacy Id Paper</title>
    <summary>Old format.</summary>
    <published>1999-01-04T00:00:00Z</published>
    <author><name>Carol C</name></author>
  </entry>
</feed>`;

describe("parseArxivAtom", () => {
  it("extracts entries with canonical ids, authors, categories", () => {
    const entries = parseArxivAtom(SAMPLE_ATOM);
    expect(entries).toHaveLength(2);
    expect(entries[0].arxivId).toBe("2601.13209");
    expect(entries[0].url).toBe("https://arxiv.org/abs/2601.13209");
    expect(entries[0].title).toBe("Test Paper: Multi-line Title");
    expect(entries[0].authors).toEqual(["Alice A", "Bob B"]);
    expect(entries[0].categories).toEqual(["cs.CL"]);
    expect(entries[0].published).toBe("2026-01-20");
    expect(entries[0].abstract).toBe(
      "An abstract with &amp; escaped &lt;chars&gt;.",
    );
    expect(entries[1].arxivId).toBe("hep-th/9901001");
  });

  it("returns empty array for garbage input", () => {
    expect(parseArxivAtom("not xml at all")).toEqual([]);
  });

  it("caps authors at 10 per entry", () => {
    // 大型合作组论文能列几百位作者，而 recommendPapers 的 output 会连作者名一起落进 D1
    const names = Array.from(
      { length: 12 },
      (_, i) => `<author><name>Author ${i + 1}</name></author>`,
    ).join("");
    const xml = `<feed><entry><id>http://arxiv.org/abs/2601.00002</id><title>T</title><summary>S</summary><published>2026-01-01T00:00:00Z</published>${names}</entry></feed>`;
    const entries = parseArxivAtom(xml);
    expect(entries[0].authors).toHaveLength(10);
    expect(entries[0].authors[0]).toBe("Author 1");
    expect(entries[0].authors[9]).toBe("Author 10");
  });

  it("truncates abstract to DISCOVERY_LIMITS.abstractChars", () => {
    const longSummary = "x".repeat(DISCOVERY_LIMITS.abstractChars + 200);
    const xml = `<feed><entry><id>http://arxiv.org/abs/2601.00001</id><title>T</title><summary>${longSummary}</summary><published>2026-01-01T00:00:00Z</published></entry></feed>`;
    const entries = parseArxivAtom(xml);
    expect(entries[0].abstract).toHaveLength(DISCOVERY_LIMITS.abstractChars);
    expect(entries[0].abstract).toBe(
      "x".repeat(DISCOVERY_LIMITS.abstractChars),
    );
  });
});

describe("normalizeArxivIds", () => {
  it("canonicalizes, drops invalid ids, and dedupes", () => {
    expect(
      normalizeArxivIds([
        "2601.13209v2",
        "https://arxiv.org/abs/2601.13209",
        "hep-th/9901001v1",
        "not an id",
      ]),
    ).toEqual(["2601.13209", "hep-th/9901001"]);
  });

  it("returns empty array when nothing is valid", () => {
    expect(normalizeArxivIds(["nope", ""])).toEqual([]);
  });
});

describe("markInLibrary", () => {
  it("marks entries whose canonical url is owned", () => {
    const entries = parseArxivAtom(SAMPLE_ATOM);
    const owned = new Map([["https://arxiv.org/abs/2601.13209", "abc123"]]);
    const marked = markInLibrary(entries, owned);
    expect(marked[0]).toMatchObject({
      inLibrary: true,
      libraryShortId: "abc123",
    });
    expect(marked[1]).toMatchObject({ inLibrary: false });
    expect(marked[1].libraryShortId).toBeUndefined();
  });
});

describe("buildDiscoveryTools external call budget", () => {
  /** minimal ToolExecutionOptions stub — only fields required by the type */
  const toolOptions = { toolCallId: "test-call", messages: [] } as never;
  const deps = {
    db: {} as unknown as DiscoveryToolsDeps["db"],
    userId: "user-1",
  };

  function getExecute(tool: { execute?: unknown }) {
    const { execute } = tool;
    if (typeof execute !== "function") throw new Error("execute is not set");
    return execute as (input: unknown, opts: never) => Promise<unknown>;
  }

  it("stops issuing external requests past the per-request budget", async () => {
    // 503 让工具在 loadOwnedUrlMap 之前就返回，于是不必 stub db
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCalls++;
      return { ok: false, status: 503 } as unknown as Response;
    });
    try {
      const tools = buildDiscoveryTools(deps);
      const searchArxiv = getExecute(tools.searchArxiv);
      const input = { query: "retrieval", sortBy: "relevance", maxResults: 8 };
      const budget = DISCOVERY_LIMITS.externalCallBudget;

      for (let i = 0; i < budget; i++) {
        await searchArxiv(input, toolOptions);
      }
      expect(fetchCalls).toBe(budget);

      const overBudget = await searchArxiv(input, toolOptions);
      expect(overBudget).toMatchObject({
        error: expect.stringContaining("budget exhausted"),
      });
      expect(fetchCalls).toBe(budget);

      // 预算是三个工具共享的，且耗尽后回错误对象而不是抛。三个都要断言：
      // 少给哪个工具加检查，都得有测试挂掉
      const daily = await getExecute(tools.listDailyPapers)({}, toolOptions);
      expect(daily).toMatchObject({
        error: expect.stringContaining("budget exhausted"),
      });
      expect(fetchCalls).toBe(budget);

      const recommend = await getExecute(tools.recommendPapers)(
        { arxivIds: ["2601.13209"] },
        toolOptions,
      );
      expect(recommend).toMatchObject({
        error: expect.stringContaining("budget exhausted"),
      });
      expect(fetchCalls).toBe(budget);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not fire during a normal search-and-recommend reply", async () => {
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCalls++;
      return { ok: false, status: 503 } as unknown as Response;
    });
    try {
      const tools = buildDiscoveryTools(deps);
      // 一次典型回复：多角度搜索若干次 + 一次 recommendPapers 取详情
      for (let i = 0; i < 4; i++) {
        await getExecute(tools.searchArxiv)(
          { query: `angle ${i}`, sortBy: "relevance", maxResults: 8 },
          toolOptions,
        );
      }
      const last = await getExecute(tools.recommendPapers)(
        { arxivIds: ["2601.13209"] },
        toolOptions,
      );
      expect(last).not.toMatchObject({
        error: expect.stringContaining("budget exhausted"),
      });
      expect(fetchCalls).toBe(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
