// src/lib/digest/candidates.ts
import { canonicalArxivId } from "#/lib/arxiv";
import type { CandidateItem, ReviewedCandidate } from "./types";

/**
 * 本期精读预算：论文与 intel 分开计。稳态下每周新增候选远小于首跑积压，
 * 预算的角色是病态周的保险丝而非常态过滤。intel 精读通过率极高（近似
 * 直通 synthesize prompt），上限须明显低于论文侧，防合成提示词膨胀。
 */
export const PAPER_REVIEW_BUDGET = 100;
export const INTEL_REVIEW_BUDGET = 50;
/** 已 rejected 的候选，HF 热度达到该值时允许重新浮出（迟到爆款） */
export const LATE_BLOOMER_UPVOTES = 30;

/**
 * 只影响来源统计、不影响页面内容的跟踪参数：算 dedupKey 前一律剥掉。
 * `utm_*` 另按前缀匹配。收成闭集而非「只保留白名单参数」——很多站点靠 query
 * 定位内容（openreview 的 ?id=、youtube 的 ?v=），过度剥离会把两篇不同的东西
 * 合并成一条。
 */
const TRACKING_PARAMS = new Set([
  "ref",
  "ref_src",
  "ref_url",
  "referrer",
  "source",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "spm",
  "cmpid",
  "__twitter_impression",
]);

/**
 * 跨期/跨来源去重键。**只用于比对，不写库**——库里的 canonical_url 是唯一索引
 * 的一半且已被 recommended 的行引用过，不能重写（见 partitionCandidates 的对齐
 * 写法：命中池里已有行时改写的是新候选的 URL，不是池里那一行）。
 *
 * 规则：去协议、host 小写去 `www.`、去 `#fragment`、去跟踪参数、去尾斜杠；
 * aclanthology 去 `.pdf` 后缀；arXiv 走 canonicalArxivId 统一 abs/pdf/版本号。
 * 两处刻意的有损：端口被丢弃（hostname 不含端口），query 值经 searchParams
 * 解码后重拼（`?q=a%20b` → `q=a b`）。两边比对走的是同一套变换，不影响判等。
 *
 * 起因（实测）：moe 第 1/2 期同引 `2026.findings-acl.1944`，池里
 * `…1944.pdf`（8/15 recommended）与 `…1944/`（8/22 recommended）是两行，
 * exact-URL 去重被 `.pdf`/尾斜杠变体整个绕过，同一篇 findings 被当新发现讲了两遍。
 */
export function urlDedupKey(raw: string): string {
  const trimmed = raw.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  // arXiv 只在 arxiv 域名上认：canonicalArxivId 的正则未锚定，任意 URL 里的
  // `1234.56789` 都会被它当成 arXiv id（见 lib/arxiv.ts 注释里的短链前科）。
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) {
    const id = canonicalArxivId(u.pathname);
    if (id) return `arxiv:${id}`;
  }
  let path = u.pathname;
  // ACL Anthology 的 `…1944.pdf` 与 `…1944/` 是同一篇的两个表示；其他站点的
  // `.pdf` 可能确实是另一个资源，不做泛化。
  if (host === "aclanthology.org") path = path.replace(/\.pdf$/i, "");
  path = path.replace(/\/+$/, "");
  const params = [...u.searchParams.entries()]
    .filter(
      ([k]) =>
        !TRACKING_PARAMS.has(k.toLowerCase()) &&
        !k.toLowerCase().startsWith("utm_"),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.map(([k, v]) => `${k}=${v}`).join("&");
  return `${host}${path}${query ? `?${query}` : ""}`;
}

/**
 * 搜索工具的中转页：exa.ai/library/* 是 Exa 自己的检索结果详情页，读者点开看到
 * 的不是论文/原文。底层论文会从 arXiv 源另行进池，直接在入池阶段丢弃即可。
 * 判据落在 dedupKey 上（已算过 key 的调用方直接用 Key 版，别重算）。
 */
export function isSearchToolArtifactKey(dedupKey: string): boolean {
  return dedupKey.toLowerCase().startsWith("exa.ai/library/");
}

export function isSearchToolArtifactUrl(url: string): boolean {
  return isSearchToolArtifactKey(urlDedupKey(url));
}

/**
 * 能不能拿这个 URL 新插一行候选。抽取阶段再小心也可能截出畸形 URL（正文里裸链
 * 紧贴中文、markdown 链接嵌套括号），而畸形 URL 一旦落库就是一行永远对不上池里
 * 真实行的死候选——正是本次要修的病。所以只在「新插行」这一步收紧：
 * 非 ASCII 直接拒（正文语境下几乎必然是把中文尾巴吞进了 URL），再过一遍
 * new URL() 与 http(s) 协议。标记池里已有行不走这道闸，那条路径无副作用。
 */
export function isStorableCandidateUrl(url: string): boolean {
  if (!/^[\x21-\x7e]+$/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 候选池行的最小形状（store 层从 direction_candidates 读出后传入） */
export interface PoolEntry {
  canonicalUrl: string;
  status: "seen" | "recommended" | "rejected";
  score: number | null;
}

/**
 * 跨来源合并去重：同 dedupKey 首见者保留，后见者只合并 sourceLabel；
 * 并用 hf_signals（arxivId → upvotes）标注热度。
 * 顺带在这里丢弃搜索工具中转页——所有入池路径（扫源/角度搜索/S2 兜底/pool
 * 重放）都汇到这个函数，是唯一的单点闸门。
 */
export function mergeCandidates(
  groups: CandidateItem[][],
  hfUpvotesByArxivId: Map<string, number>,
): CandidateItem[] {
  const byUrl = new Map<string, CandidateItem>();
  for (const group of groups) {
    for (const item of group) {
      const key = urlDedupKey(item.canonicalUrl);
      if (isSearchToolArtifactKey(key)) {
        console.warn(
          `[Digest] dropping search-tool artifact URL: ${item.canonicalUrl}`,
        );
        continue;
      }
      const existing = byUrl.get(key);
      if (existing) {
        if (!existing.sourceLabel.split(",").includes(item.sourceLabel)) {
          existing.sourceLabel = `${existing.sourceLabel},${item.sourceLabel}`;
        }
        if ((item.prescore ?? -1) > (existing.prescore ?? -1)) {
          existing.prescore = item.prescore;
        }
        continue;
      }
      const arxivId = canonicalArxivId(item.canonicalUrl);
      const hfUpvotes = arxivId ? hfUpvotesByArxivId.get(arxivId) : undefined;
      byUrl.set(key, { ...item, hfUpvotes });
    }
  }
  return [...byUrl.values()];
}

export interface PartitionResult {
  toReview: CandidateItem[];
  /** 与池比对被跳过（已推荐 / 已拒且无新信号） */
  skipped: CandidateItem[];
  /** 预算外，记 seen 留待下期；名单进简报生成日志（no silent caps） */
  overBudget: CandidateItem[];
}

/** 池里同 dedupKey 有多行时的取舍序：抑制力强者优先（否则 `.pdf` 变体会对到
 * 一行 seen 上，重新参评又讲一遍） */
const STATUS_RANK = { recommended: 0, rejected: 1, seen: 2 } as const;

/**
 * 对齐历史候选池 + 应用精读预算。热度高者优先占预算。
 *
 * 池比对按 dedupKey，但**返回的候选 URL 会被改写成池里那一行的 canonical_url**：
 * 下游 upsertCandidatesSeen / updateCandidateStatus 都按 canonical_url 定位，
 * 不对齐的话 `…1944.pdf` 会插出第二行，跨期去重再次失效。
 */
export function partitionCandidates(
  merged: CandidateItem[],
  pool: PoolEntry[],
): PartitionResult {
  const poolByKey = new Map<string, PoolEntry>();
  for (const p of pool) {
    const key = urlDedupKey(p.canonicalUrl);
    const prev = poolByKey.get(key);
    if (!prev || STATUS_RANK[p.status] < STATUS_RANK[prev.status]) {
      poolByKey.set(key, p);
    }
  }
  const eligible: CandidateItem[] = [];
  const skipped: CandidateItem[] = [];
  for (const raw of merged) {
    const entry = poolByKey.get(urlDedupKey(raw.canonicalUrl));
    const item =
      entry && entry.canonicalUrl !== raw.canonicalUrl
        ? { ...raw, canonicalUrl: entry.canonicalUrl }
        : raw;
    if (!entry) {
      eligible.push(item);
      continue;
    }
    if (entry.status === "recommended") {
      skipped.push(item);
      continue;
    }
    if (entry.status === "rejected") {
      // 迟到爆款：拒过但 HF 热度显著，允许重评
      if ((item.hfUpvotes ?? 0) >= LATE_BLOOMER_UPVOTES) eligible.push(item);
      else skipped.push(item);
      continue;
    }
    // status === "seen"（上期预算外或未评审）：本期重新参评
    eligible.push(item);
  }
  // 预算裁剪砍尾：热度优先、初筛分次之、新发布再次——被砍的永远是最不可惜的
  eligible.sort(
    (a, b) =>
      (b.hfUpvotes ?? 0) - (a.hfUpvotes ?? 0) ||
      (b.prescore ?? 0) - (a.prescore ?? 0) ||
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
  );
  const papers = eligible.filter((i) => i.kind === "paper");
  const intel = eligible.filter((i) => i.kind === "intel");
  return {
    toReview: [
      ...papers.slice(0, PAPER_REVIEW_BUDGET),
      ...intel.slice(0, INTEL_REVIEW_BUDGET),
    ],
    skipped,
    overBudget: [
      ...papers.slice(PAPER_REVIEW_BUDGET),
      ...intel.slice(INTEL_REVIEW_BUDGET),
    ],
  };
}

/** 精读后进入 synthesize 的供给集大小（含并列会放宽到 ~10-15） */
export const TOP_K_PAPERS = 10;

/**
 * 含并列 top-K：取「score ≥ 第 k 名 score」的全部论文。
 * 必须含并列——实测 review 分大量并列（8 篇挤 88 分），硬 K 切线的 tie-break
 * 是随机序，会让入选集在重跑间抖动（#72 E6：Jaccard 仅 0.72）。
 */
export function selectTopPapers(
  papers: ReviewedCandidate[],
  k: number,
): ReviewedCandidate[] {
  if (papers.length <= k) return [...papers];
  const sorted = [...papers].sort((a, b) => b.review.score - a.review.score);
  const threshold = sorted[k - 1].review.score;
  return sorted.filter((p) => p.review.score >= threshold);
}

/** 正文里的一条外链：url + 展示文字（无文字时回退 URL 本身） */
export interface ContentLink {
  url: string;
  title: string;
}

/**
 * 扫出正文（主语言 markdown）里的全部 http(s) 外链，含 `[文字](url)` 与裸链，
 * 按 dedupKey 去重、保留首次出现的展示文字。
 *
 * 用途见 workflow finalize：synthesize 自报的 usedIntelUrls 会漏——第 1 期正文
 * 引用的 OpenAI 那条 URL 来自 the-decoder 报道的正文，从来就不在候选池里，
 * 自然也匹配不上 intelCandidates，于是第 3 期又当新闻讲了一遍。正文实扫是补漏
 * 口径：正文出现过的外链一律记成「已讲过」。
 */
export function extractContentLinks(markdown: string): ContentLink[] {
  // 每次新建（而非模块级常量）：/g 正则带 lastIndex 状态，跨调用复用会漏匹配
  //
  // URL 段两处边界都是实测踩出来的：
  // - markdown 链接允许一层平衡括号，否则维基百科的
  //   `…/Mixture_of_experts_(MoE)` 会被截成 `…_(MoE`；
  // - 裸链只收 RFC 3986 的合法字符，否则「https://…/abc的说明，另见」会把整条
  //   中文尾巴吞进 URL。
  const mdLink =
    /(!?)\[([^\]]*)\]\(\s*<?(https?:\/\/(?:[^\s<>()]|\([^\s<>()]*\))+)>?[^)\n]*\)/g;
  const bareUrl = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]+/g;
  const trailingJunk = /[)\]}>.,;:!?"'’”，。；：、）】」！？]+$/;
  const out: ContentLink[] = [];
  const seen = new Set<string>();
  const push = (url: string, title: string) => {
    if (!/^https?:\/\/\S/i.test(url)) return;
    const key = urlDedupKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url, title: title.replace(/\*+/g, "").trim() || url });
  };
  // 先摘 markdown 链接并把整段抹成等长空白，剩下的才当裸链扫，避免同一条
  // 链接被数两次（图片 `![alt](url)` 不算引用，跳过）。markdown 那侧的 URL
  // 由 `)` 界定、已经是完整的，**不能再剥尾部标点**——`…_(MoE)` 的收尾括号
  // 是 URL 的一部分。只有裸链需要剥掉句末标点。
  const rest = markdown.replace(mdLink, (whole, bang, text, url) => {
    if (!bang) push(url, text);
    return " ".repeat(whole.length);
  });
  for (const m of rest.matchAll(bareUrl))
    push(m[0].replace(trailingJunk, ""), "");
  return out;
}

const normalizeForMatch = (s: string) =>
  s
    .toLowerCase()
    // 直引号用于缩写（don't），保留；弯双引号是包裹引用的装饰符，随其余
    // 标点一起在下一步被剥离——否则残留的引号字符会让「原文无引号」的
    // 逐字引用永远不命中。
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * noveltyQuote 是否「逐字」出自全文。规范化后先整段 substring；未中则 8 词滑窗
 * （步长 4）命中率 ≥70% 判 true——review 合法引文常含省略号拼接或公式转码差异
 * （#72 实测 74 份：51 精确 + 19 滑窗命中 + 4 公式 miss，零捏造）。
 */
export function quoteAppearsInText(quote: string, text: string): boolean {
  const q = normalizeForMatch(quote);
  if (!q) return false;
  const t = normalizeForMatch(text);
  if (t.includes(q)) return true;
  const words = q.split(" ");
  if (words.length < 8) return false;
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 8 <= words.length; i += 4) {
    total++;
    if (t.includes(words.slice(i, i + 8).join(" "))) hit++;
  }
  return total > 0 && hit / total >= 0.7;
}
