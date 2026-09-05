// src/lib/digest/candidates.test.ts
import { describe, expect, it } from "vitest";
import {
  extractContentLinks,
  isSearchToolArtifactUrl,
  LATE_BLOOMER_UPVOTES,
  mergeCandidates,
  PAPER_REVIEW_BUDGET,
  partitionCandidates,
  quoteAppearsInText,
  selectTopPapers,
  urlDedupKey,
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

// 以下三组是生产 direction_candidates 里的真实变体（moe 第 1/2/3 期跨期重复的
// 根因）：ACL 1944/857 各有 `.pdf` 与尾斜杠两行，OpenAI 那条差一个尾斜杠。
const ACL_1944 = "https://aclanthology.org/2026.findings-acl.1944";
const ACL_857 = "https://aclanthology.org/2026.findings-acl.857";
const OPENAI_CODING =
  "https://openai.com/index/separating-signal-from-noise-coding-evaluations";

describe("urlDedupKey", () => {
  it("collapses aclanthology .pdf / trailing-slash variants", () => {
    const key = urlDedupKey(`${ACL_1944}/`);
    expect(urlDedupKey(`${ACL_1944}.pdf`)).toBe(key);
    expect(urlDedupKey(ACL_1944)).toBe(key);
    expect(key).toBe("aclanthology.org/2026.findings-acl.1944");
  });

  it("collapses the 857 pair the same way", () => {
    expect(urlDedupKey(`${ACL_857}.pdf`)).toBe(urlDedupKey(`${ACL_857}/`));
  });

  it("collapses trailing slash, www, scheme, fragment and tracking params", () => {
    const key = urlDedupKey(`${OPENAI_CODING}/`);
    expect(urlDedupKey(OPENAI_CODING)).toBe(key);
    expect(
      urlDedupKey(
        "http://www.openai.com/index/separating-signal-from-noise-coding-evaluations?utm_source=twitter&ref=thedecoder#results",
      ),
    ).toBe(key);
  });

  it("unifies arXiv abs / pdf / versioned URLs", () => {
    const key = urlDedupKey("https://arxiv.org/abs/2508.01234");
    expect(urlDedupKey("https://arxiv.org/pdf/2508.01234")).toBe(key);
    expect(urlDedupKey("https://arxiv.org/abs/2508.01234v2")).toBe(key);
    expect(urlDedupKey("http://www.arxiv.org/pdf/2508.01234v3.pdf")).toBe(key);
    expect(key).toBe("arxiv:2508.01234");
  });

  it("keeps content-bearing query params distinct", () => {
    expect(urlDedupKey("https://openreview.net/forum?id=AAA")).not.toBe(
      urlDedupKey("https://openreview.net/forum?id=BBB"),
    );
    // 参数顺序不该影响身份
    expect(urlDedupKey("https://e.com/x?b=2&a=1")).toBe(
      urlDedupKey("https://e.com/x?a=1&b=2"),
    );
  });

  it("does not read arXiv ids out of non-arXiv URLs", () => {
    expect(urlDedupKey("https://example.com/2508.01234")).toBe(
      "example.com/2508.01234",
    );
  });

  it("falls back to the lowercased string for unparseable input", () => {
    expect(urlDedupKey("  Not A URL ")).toBe("not a url");
  });
});

describe("isSearchToolArtifactUrl", () => {
  it("flags exa.ai library pages only", () => {
    expect(
      isSearchToolArtifactUrl("https://exa.ai/library/publication/abc-123"),
    ).toBe(true);
    expect(isSearchToolArtifactUrl("https://exa.ai/search?q=moe")).toBe(false);
    expect(isSearchToolArtifactUrl(ACL_1944)).toBe(false);
  });
});

describe("mergeCandidates URL-variant dedup", () => {
  it("merges .pdf and trailing-slash variants into one candidate", () => {
    const merged = mergeCandidates(
      [
        [paper(`${ACL_1944}.pdf`)],
        [paper(`${ACL_1944}/`, { sourceLabel: "angle-1" })],
      ],
      new Map(),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].canonicalUrl).toBe(`${ACL_1944}.pdf`); // 首见者保留
    expect(merged[0].sourceLabel).toBe("src-a,angle-1");
  });

  it("drops exa.ai library artifacts at ingest", () => {
    const merged = mergeCandidates(
      [
        [
          paper("https://exa.ai/library/publication/deadbeef"),
          paper("https://arxiv.org/abs/2508.00002"),
        ],
      ],
      new Map(),
    );
    expect(merged.map((m) => m.canonicalUrl)).toEqual([
      "https://arxiv.org/abs/2508.00002",
    ]);
  });
});

describe("partitionCandidates pool alignment", () => {
  it("skips a .pdf variant of an already-recommended pool row", () => {
    const result = partitionCandidates(
      [paper(`${ACL_1944}.pdf`)],
      [{ canonicalUrl: `${ACL_1944}/`, status: "recommended", score: 90 }],
    );
    expect(result.toReview).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("rewrites an incoming variant onto the existing pool row's URL", () => {
    const result = partitionCandidates(
      [paper(`${ACL_857}/`)],
      [{ canonicalUrl: `${ACL_857}.pdf`, status: "seen", score: null }],
    );
    expect(result.toReview).toHaveLength(1);
    // 对齐后 upsert 落到老行上，不会插出第二行
    expect(result.toReview[0].canonicalUrl).toBe(`${ACL_857}.pdf`);
  });

  it("prefers the strongest-suppressing row when the pool holds duplicates", () => {
    const result = partitionCandidates(
      [paper(`${ACL_1944}.pdf`)],
      [
        { canonicalUrl: `${ACL_1944}.pdf`, status: "seen", score: null },
        { canonicalUrl: `${ACL_1944}/`, status: "recommended", score: 88 },
      ],
    );
    expect(result.toReview).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("leaves genuinely new candidates untouched", () => {
    const result = partitionCandidates(
      [paper("https://arxiv.org/abs/2508.09999")],
      [{ canonicalUrl: `${ACL_1944}/`, status: "recommended", score: 90 }],
    );
    expect(result.toReview).toHaveLength(1);
    expect(result.toReview[0].canonicalUrl).toBe(
      "https://arxiv.org/abs/2508.09999",
    );
  });
});

describe("extractContentLinks", () => {
  it("pulls markdown links, bare URLs and angle-bracket links with their text", () => {
    const md = [
      `本期第一条见 [OpenAI 的评测反思](${OPENAI_CODING}/)。`,
      `另有 ACL findings（<${ACL_857}.pdf>）与裸链 ${ACL_1944}/ 两条。`,
    ].join("\n");
    const links = extractContentLinks(md);
    expect(links).toEqual([
      { url: `${OPENAI_CODING}/`, title: "OpenAI 的评测反思" },
      { url: `${ACL_857}.pdf`, title: `${ACL_857}.pdf` },
      { url: `${ACL_1944}/`, title: `${ACL_1944}/` },
    ]);
  });

  it("dedups URL variants of the same target, keeping the first", () => {
    const links = extractContentLinks(
      `[a](${ACL_1944}.pdf) 与 [b](${ACL_1944}/) 是同一篇`,
    );
    expect(links).toEqual([{ url: `${ACL_1944}.pdf`, title: "a" }]);
  });

  it("strips trailing sentence punctuation from bare URLs", () => {
    expect(extractContentLinks(`见 ${OPENAI_CODING}，另见别处。`)[0].url).toBe(
      OPENAI_CODING,
    );
    expect(extractContentLinks(`见 ${OPENAI_CODING}.`)[0].url).toBe(
      OPENAI_CODING,
    );
  });

  it("ignores images and non-http links", () => {
    const links = extractContentLinks(
      `![封面](https://cdn.example.com/a.png) [邮件](mailto:x@y.z) [锚点](#section)`,
    );
    expect(links).toEqual([]);
  });

  it("returns nothing for link-free content", () => {
    expect(extractContentLinks("本期没有任何外链。")).toEqual([]);
  });
});
