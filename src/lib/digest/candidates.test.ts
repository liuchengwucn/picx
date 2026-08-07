// src/lib/digest/candidates.test.ts
import { describe, expect, it } from "vitest";
import {
  LATE_BLOOMER_UPVOTES,
  mergeCandidates,
  PAPER_REVIEW_BUDGET,
  partitionCandidates,
  tallyVotes,
} from "./candidates";
import type { CandidateItem } from "./types";

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
});

describe("tallyVotes", () => {
  const yes = { refuted: false, evidence: "" };
  const no = { refuted: true, evidence: "" };
  it("passes with majority non-refuted", () => {
    expect(tallyVotes([yes, yes, no])).toBe("pass");
  });
  it("rejects with 2+ refutations", () => {
    expect(tallyVotes([no, no, yes])).toBe("rejected");
  });
  it("returns unverified when too few valid votes", () => {
    expect(tallyVotes([yes, null, null])).toBe("unverified");
    expect(tallyVotes([null, null, null])).toBe("unverified");
  });
  it("still rejects on 2 refutations even with errored third vote", () => {
    expect(tallyVotes([no, no, null])).toBe("rejected");
  });
});
