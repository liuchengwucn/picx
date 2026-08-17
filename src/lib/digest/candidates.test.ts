// src/lib/digest/candidates.test.ts
import { describe, expect, it } from "vitest";
import {
  LATE_BLOOMER_UPVOTES,
  mergeCandidates,
  PAPER_REVIEW_BUDGET,
  partitionCandidates,
  quoteAppearsInText,
  selectTopPapers,
} from "./candidates";
import type { CandidateItem, ReviewedCandidate } from "./types";

function paper(url: string, extra: Partial<CandidateItem> = {}): CandidateItem {
  return {
    canonicalUrl: url,
    title: url,
    kind: "paper",
    sourceLabel: "src-a",
    ...extra,
  };
}

describe("mergeCandidates", () => {
  it("dedups by canonicalUrl and merges sourceLabel", () => {
    const merged = mergeCandidates(
      [
        [paper("https://arxiv.org/abs/2508.00001")],
        [paper("https://arxiv.org/abs/2508.00001", { sourceLabel: "angle-1" })],
      ],
      new Map(),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceLabel).toBe("src-a,angle-1");
  });

  it("attaches hf upvotes by arxiv id", () => {
    const merged = mergeCandidates(
      [[paper("https://arxiv.org/abs/2508.00002")]],
      new Map([["2508.00002", 55]]),
    );
    expect(merged[0].hfUpvotes).toBe(55);
  });

  it("does not drop a label that is a strict substring of the existing label", () => {
    const merged = mergeCandidates(
      [
        [
          paper("https://arxiv.org/abs/2508.00003", {
            sourceLabel: "atp-verify",
          }),
        ],
        [paper("https://arxiv.org/abs/2508.00003", { sourceLabel: "atp" })],
      ],
      new Map(),
    );
    expect(merged).toHaveLength(1);
    const labels = merged[0].sourceLabel.split(",");
    expect(labels).toContain("atp-verify");
    expect(labels).toContain("atp");
  });

  it("keeps the higher prescore when the same url appears in two groups", () => {
    const merged = mergeCandidates(
      [
        [paper("https://arxiv.org/abs/2508.00004", { prescore: 60 })],
        [paper("https://arxiv.org/abs/2508.00004", { prescore: 85 })],
      ],
      new Map(),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].prescore).toBe(85);
  });
});

describe("partitionCandidates", () => {
  it("skips recommended, revives rejected late bloomers, reviews seen", () => {
    const items = [
      paper("u-recommended"),
      paper("u-rejected-cold"),
      paper("u-rejected-hot", { hfUpvotes: LATE_BLOOMER_UPVOTES }),
      paper("u-seen"),
      paper("u-new"),
    ];
    const result = partitionCandidates(items, [
      { canonicalUrl: "u-recommended", status: "recommended", score: 80 },
      { canonicalUrl: "u-rejected-cold", status: "rejected", score: 20 },
      { canonicalUrl: "u-rejected-hot", status: "rejected", score: 20 },
      { canonicalUrl: "u-seen", status: "seen", score: null },
    ]);
    const urls = result.toReview.map((i) => i.canonicalUrl);
    expect(urls).toContain("u-rejected-hot");
    expect(urls).toContain("u-seen");
    expect(urls).toContain("u-new");
    expect(result.skipped.map((i) => i.canonicalUrl).sort()).toEqual([
      "u-recommended",
      "u-rejected-cold",
    ]);
  });

  it("applies paper budget with hf-upvote priority and reports overflow", () => {
    const items = Array.from({ length: PAPER_REVIEW_BUDGET + 3 }, (_, i) =>
      paper(`u-${i}`, { hfUpvotes: i }),
    );
    const result = partitionCandidates(items, []);
    expect(result.toReview).toHaveLength(PAPER_REVIEW_BUDGET);
    expect(result.overBudget).toHaveLength(3);
    // 热度最低的 3 个被挤出
    expect(result.overBudget.map((i) => i.hfUpvotes)).toEqual([2, 1, 0]);
  });

  it("budget cuts the lowest-prescore item when no hf upvotes", () => {
    const items = Array.from({ length: PAPER_REVIEW_BUDGET + 1 }, (_, i) =>
      paper(`u-${i}`, { prescore: 100 - i }),
    );
    const result = partitionCandidates(items, []);
    expect(result.toReview).toHaveLength(PAPER_REVIEW_BUDGET);
    expect(result.overBudget).toHaveLength(1);
    expect(result.overBudget[0].prescore).toBe(100 - PAPER_REVIEW_BUDGET);
  });
});

const rc = (url: string, score: number): ReviewedCandidate => ({
  item: { canonicalUrl: url, title: url, kind: "paper", sourceLabel: "t" },
  review: {
    novelty: "",
    noveltyQuote: "",
    relevance: 0,
    recommendation: "",
    score,
  },
});

describe("selectTopPapers", () => {
  it("returns all when fewer than k", () => {
    expect(selectTopPapers([rc("a", 90), rc("b", 80)], 10)).toHaveLength(2);
  });
  it("includes ties at the boundary", () => {
    const papers = [rc("a", 90), rc("b", 88), rc("c", 88), rc("d", 85)];
    const top = selectTopPapers(papers, 2);
    expect(top.map((p) => p.item.canonicalUrl).sort()).toEqual(["a", "b", "c"]);
  });
  it("sorts descending by score", () => {
    const top = selectTopPapers(
      [rc("low", 60), rc("hi", 90), rc("mid", 70)],
      2,
    );
    expect(top[0].item.canonicalUrl).toBe("hi");
  });
});

describe("quoteAppearsInText", () => {
  const text =
    "We propose DarwinX, a framework that searches the harness rather than whole-agent code, " +
    "admits a child only under a preserve-and-extend contract that bounds regression, " +
    "and recombines complementary specialists across lineages for four benchmarks, " +
    "evaluated on SWE-bench, AgentBench, WebArena, and a held-out internal suite.";
  it("matches verbatim quotes despite punctuation and curly quotes", () => {
    expect(
      quoteAppearsInText(
        "searches the “harness” rather than whole-agent code",
        text,
      ),
    ).toBe(true);
  });
  it("matches ellipsis-joined segments via sliding windows", () => {
    const q =
      "searches the harness rather than whole-agent code, admits a child only under a preserve-and-extend contract ... recombines complementary specialists across lineages for four benchmarks, evaluated on SWE-bench, AgentBench, WebArena, and a held-out internal suite.";
    expect(quoteAppearsInText(q, text)).toBe(true);
  });
  it("rejects fabricated quotes", () => {
    expect(
      quoteAppearsInText(
        "this method achieves state of the art results on every benchmark we tested against",
        text,
      ),
    ).toBe(false);
  });
  it("rejects empty quote", () => {
    expect(quoteAppearsInText("", text)).toBe(false);
  });
});
