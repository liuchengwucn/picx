import { describe, expect, it } from "vitest";
import {
  authorSignalBlock,
  buildReviewSystemPrompt,
  normalizeResolvedMonth,
  parseHardRule,
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
      },
      { issueNumber: 11, title: "Plain", note: "" },
    ]);
    expect(out).toBe("- [#12] Multi line title — why read it\n- [#11] Plain");
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
  const focus = "硬标准：只报单个饱和基准且无 held-out 的按 filler 处理。";

  it("injects the focus brief and the hard-rule section with its JSON shape", () => {
    const out = buildReviewSystemPrompt(focus, []);
    expect(out).toContain(focus);
    expect(out).toContain("- hard_rule:");
    expect(out).toContain("硬标准");
    expect(out).toContain("一律不选");
    expect(out).toContain('"hard_rule":{"violated":bool');
    // 契约行必须让模型知道 hard_rule 属于顶层返回，否则它会塞进 recommendation
    expect(out).toContain(
      '"hard_rule":{"violated":false,"rule":"","reason":""}',
    );
  });

  it("keeps the hard-rule section applicable to non-paper items", () => {
    expect(buildReviewSystemPrompt(focus, [])).toMatch(
      /non-paper items[\s\S]*out-of-scope intel/,
    );
  });

  it("still renders the prior-picks block (unconditional injection contract)", () => {
    expect(buildReviewSystemPrompt(focus, [])).toContain(
      "(no prior picks yet)",
    );
  });
});

describe("parseHardRule", () => {
  it("treats a missing field as not violated (old response shape must not break)", () => {
    for (const raw of [undefined, null, "", 0, "nope", []]) {
      expect(parseHardRule(raw)).toEqual({
        violated: false,
        rule: "",
        reason: "",
      });
    }
  });

  it("parses a complete verdict, collapsing whitespace", () => {
    expect(
      parseHardRule({
        violated: true,
        rule: "只报单个饱和基准\n 且无 held-out",
        reason: "  仅在 GSM8K 上报增益  ",
      }),
    ).toEqual({
      violated: true,
      rule: "只报单个饱和基准 且无 held-out",
      reason: "仅在 GSM8K 上报增益",
    });
  });

  it("keeps violated=true when rule/reason are missing or wrong-typed", () => {
    expect(parseHardRule({ violated: true })).toEqual({
      violated: true,
      rule: "",
      reason: "",
    });
    expect(parseHardRule({ violated: "true", rule: 42, reason: null })).toEqual(
      {
        violated: true,
        rule: "",
        reason: "",
      },
    );
  });

  it("treats any non-true violated value as not violated (unsure => false)", () => {
    expect(parseHardRule({ violated: "maybe", rule: "r" }).violated).toBe(
      false,
    );
    expect(parseHardRule({ violated: false, rule: "r" }).violated).toBe(false);
  });

  it("truncates over-long rule and reason instead of throwing", () => {
    const out = parseHardRule({
      violated: true,
      rule: "规".repeat(400),
      reason: "由".repeat(900),
    });
    expect(out.rule).toHaveLength(120);
    expect(out.reason).toHaveLength(300);
  });
});
