import { describe, expect, it } from "vitest";
import {
  authorSignalBlock,
  buildReviewSystemPrompt,
  normalizeResolvedMonth,
  pastPicksBlock,
} from "./ai";
import type { CandidateItem } from "./types";

describe("pastPicksBlock", () => {
  it("renders a placeholder for an empty list (unconditional injection contract)", () => {
    expect(pastPicksBlock([])).toBe("(no prior picks yet)");
  });

  it("renders one line per pick with issue number, collapsing whitespace, omitting empty notes", () => {
    const out = pastPicksBlock([
      {
        issueNumber: 12,
        title: "  Multi\n line\ttitle ",
        note: "why  read\nit",
        canonicalUrl: null,
      },
      { issueNumber: 11, title: "Plain", note: "", canonicalUrl: null },
    ]);
    // 行首是「第N期」而不是「[#N]」：模型会把记号原样抄进正文，源头就得是合法写法
    expect(out).toBe("- 第12期 Multi line title — why read it\n- 第11期 Plain");
  });

  // URL 是 A1 的核心：没有它模型给往期 pick 配链接只能瞎编（moe 第 2/3 期实证）
  it("appends the paper URL when known, with and without a note", () => {
    const out = pastPicksBlock([
      {
        issueNumber: 3,
        title: "PR²",
        note: "值得读",
        canonicalUrl: "https://arxiv.org/abs/2607.11111",
      },
      {
        issueNumber: 2,
        title: "Kimi K3",
        note: "",
        canonicalUrl: "  https://arxiv.org/abs/2606.22222\n",
      },
    ]);
    expect(out).toBe(
      [
        "- 第3期 PR² — 值得读 (https://arxiv.org/abs/2607.11111)",
        // URL 也过 clean()：库里的脏值不能破坏行结构
        "- 第2期 Kimi K3 (https://arxiv.org/abs/2606.22222)",
      ].join("\n"),
    );
  });
});

const baseItem: CandidateItem = {
  canonicalUrl: "https://arxiv.org/abs/2508.00001",
  title: "T",
  kind: "paper",
  sourceLabel: "src",
};

describe("authorSignalBlock", () => {
  it("returns empty string for intel candidates", () => {
    expect(authorSignalBlock({ ...baseItem, kind: "intel" })).toBe("");
  });

  it("renders the do-not-penalize line when signal is missing (unconditional injection)", () => {
    expect(authorSignalBlock(baseItem)).toBe(
      "Author signal: not yet indexed by Semantic Scholar (common for very fresh papers — do NOT penalize).",
    );
  });

  it("renders truncated authors line plus full metric line", () => {
    const out = authorSignalBlock({
      ...baseItem,
      authors: ["A", "B", "C", "D", "E", "Z"],
      authorCount: 24,
      authorSignal: {
        first: { name: "A", hIndex: 3, citations: 245 },
        last: { name: "Z", hIndex: 52, citations: 18340 },
        maxHIndex: 61,
        totalAuthors: 24,
      },
    });
    expect(out).toBe(
      [
        "Authors: A, B, C, D, E, ... +18 more; last: Z",
        "Author signal (Semantic Scholar): first author A h-index 3 (245 citations); last author Z h-index 52 (18340 citations); max h-index across 24 authors: 61.",
      ].join("\n"),
    );
  });

  it("single author renders one segment with unknown metrics", () => {
    const out = authorSignalBlock({
      ...baseItem,
      authors: ["Solo"],
      authorCount: 1,
      authorSignal: {
        first: { name: "Solo", hIndex: null, citations: null },
        last: { name: "Solo", hIndex: null, citations: null },
        maxHIndex: null,
        totalAuthors: 1,
      },
    });
    expect(out).toBe(
      [
        "Authors: Solo",
        "Author signal (Semantic Scholar): first author Solo h-index unknown (unknown citations).",
      ].join("\n"),
    );
  });

  it("two authors render first and last but no max segment", () => {
    const out = authorSignalBlock({
      ...baseItem,
      authorSignal: {
        first: { name: "F", hIndex: 2, citations: 10 },
        last: { name: "L", hIndex: 30, citations: 5000 },
        maxHIndex: 30,
        totalAuthors: 2,
      },
    });
    expect(out).toBe(
      "Author signal (Semantic Scholar): first author F h-index 2 (10 citations); last author L h-index 30 (5000 citations).",
    );
  });

  it("renders authors line plus do-not-penalize line when only authors are known", () => {
    const out = authorSignalBlock({
      ...baseItem,
      authors: ["A", "B"],
      authorCount: 2,
    });
    expect(out).toBe(
      [
        "Authors: A, B",
        "Author signal: not yet indexed by Semantic Scholar (common for very fresh papers — do NOT penalize).",
      ].join("\n"),
    );
  });

  it("falls back to the do-not-penalize line when a signal has no renderable parts", () => {
    const out = authorSignalBlock({
      ...baseItem,
      authorSignal: {
        first: null,
        last: null,
        maxHIndex: null,
        totalAuthors: 0,
      },
    });
    expect(out).toBe(
      "Author signal: not yet indexed by Semantic Scholar (common for very fresh papers — do NOT penalize).",
    );
  });
});

describe("normalizeResolvedMonth", () => {
  it("normalizes YYYY-MM to first-of-month", () => {
    expect(normalizeResolvedMonth("2026-07")).toBe("2026-07-01");
  });
  it("accepts YYYY-MM-DD and truncates to month", () => {
    expect(normalizeResolvedMonth("2025-10-14")).toBe("2025-10-01");
  });
  it("rejects garbage, empty, and out-of-range months", () => {
    expect(normalizeResolvedMonth("")).toBeNull();
    expect(normalizeResolvedMonth(undefined)).toBeNull();
    expect(normalizeResolvedMonth("October 2025")).toBeNull();
    expect(normalizeResolvedMonth("2026-13")).toBeNull();
    expect(normalizeResolvedMonth("1999-05")).toBeNull();
  });
});

describe("buildReviewSystemPrompt", () => {
  const focus = "只关注 coding agent 的评测方法与可复现实验。";

  it("injects the focus brief and the JSON return contract", () => {
    const out = buildReviewSystemPrompt(focus, []);
    expect(out).toContain(focus);
    expect(out).toContain(
      'Return JSON only: {"novelty":"...","noveltyQuote":"...","relevance":n,"recommendation":"...","score":n}',
    );
  });

  it("still renders the prior-picks block (unconditional injection contract)", () => {
    expect(buildReviewSystemPrompt(focus, [])).toContain(
      "(no prior picks yet)",
    );
  });
});
