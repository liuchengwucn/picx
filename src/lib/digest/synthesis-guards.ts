// src/lib/digest/synthesis-guards.ts
/**
 * synthesizeDigest 的出口校验（纯函数，无 IO）。
 *
 * 前三期线上简报暴露的四类出口缺陷，都是「prompt 说了但模型不照做」，所以每一类
 * 都按同一套路处理：**检出 → 带违规样例重试一次 → 仍违规则按可修/不可修分流**
 * （可修的代码就地改写，不可修的 console.warn 放行）。任何一类都不得抛错——
 * 一期简报的价值远高于一处措辞瑕疵，出口校验绝不能成为整期失败的新来源。
 */
import { canonicalArxivId } from "#/lib/arxiv";

/** 三节标题必须逐字如此（prompt 里同样写死），代码只校验首尾两节：
 * 「社区与动态」在无 intel 时允许整节缺席。 */
export const SECTION_LEAD = "## 本期看点";
export const SECTION_OPEN_QUESTIONS = "## 未解之问";

/**
 * 内部记号：读者无法解析的位置码与期号简写。
 * - `P1` / `I3`：素材块里的候选位置码（原有防线）
 * - `[#3]` / `#1 期` / `上期 #2`：往期清单 `- [#N] …` 的行内记号被原样搬进正文
 *   （线上 efficient-attention / moe / pretrain-data 三个方向各出一种式样）
 * 允许的写法只有「第 N 期的 X」。
 */
const INTERNAL_REF_RE = /\b[IP]\d{1,2}\b|\[#\d+\]|#\d+\s*期|上期\s*#\s*\d+/;

/**
 * 内部措辞黑名单：素材块的字段名与内部指标名，混进面向读者的推荐语/正文即是穿帮
 * （self-improvement 第 3 期「作者信号弱」、pretrain-data 第 2 期「摘要较薄」）。
 * 英文项按大小写不敏感匹配。
 */
export const INTERNAL_WORDING_TERMS = [
  "作者信号",
  "author signal",
  "全文不可得",
  "Draft note",
  "Risk flags",
  "摘要较薄",
] as const;

/**
 * 「本周」类时间措辞：169 篇 picks 里六成是数月前的论文，正文一律说「本期」。
 *
 * 负向先行断言排掉「本周五/本周末/本周期/本周刊/这周日……」——它们的「周」属于
 * 后一个词，替换成「本期五」「本期末」会把好句子改坏。检出与替换共用这一条正则，
 * 口径不可能漂。刻意不带 /g：带 /g 的正则 test() 有 lastIndex 状态，跨多段文本
 * 轮询会漏检；replaceWeeklyWording 里再按 source 现造带 /g 的。
 */
const WEEKLY_WORDING_RE = /(?:本|这)周(?![期刊末日一二三四五六天年初中])/;

/** 标题里的期号前缀：栏眉已显示 ISSUE N，标题再带一次就是双重期号。
 * 四语都可能出现（zh 期 / zh-tw 期 / ja 号·回 / en Issue），分隔符含全半角。 */
const ISSUE_PREFIX_RE =
  /^\s*(?:第\s*\d+\s*(?:期|号|號|回)|(?:Issue|Vol\.?|No\.?)\s*#?\s*\d+)\s*[:：—\-–·|｜]\s*/i;

/**
 * markdown 行内链接（含可选 title 段）。只覆盖 inline 形态：
 * 引用式链接 `[t][ref]` + `[ref]: url` 与尖括号自动链接 `<url>` 都不匹配，
 * 定稿 prompt 只要求 inline 形态，出现别的形态时降级会静默不生效（只 warn 留痕）。
 * 图片 `![alt](url)` 的 `!` 不在匹配范围内，降级后会留下 `!alt`——
 * 简报正文不产图片链接，不额外处理。
 */
const MD_LINK_RE = /\[([^\]\n]*)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g;

/**
 * 裸 URL：用于检出没写成 markdown 链接的引用。
 * 右界刻意在 `)` 处断——URL 绝大多数不含 `)`，而 markdown 链接 `[t](url)` 与
 * 中文行文里的 `（见 url）` 都以 `)` 收尾，在此断开才能取到干净的链接；
 * 代价是极少数路径里真含 `)` 的 URL 会被截短（只影响留痕文案，不影响降级——
 * 降级走 MD_LINK_RE 的完整匹配）。
 */
const BARE_URL_RE = /https?:\/\/[^\s)<>"'\]，。；：！？]+/g;

/** URL 尾随标点不属于链接本身（正文里常见 `…(url)。`） */
function trimTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?)\]}>"'。，、；：！？]+$/, "");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** host 是 arxiv.org 或其子域 */
export function isArxivUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && /(^|\.)arxiv\.org$/.test(host);
}

/** host 是 exa.ai：搜索工具的 /library/ 内部页，读者点开不是论文页，一律降级 */
export function isExaUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && /(^|\.)exa\.ai$/.test(host);
}

/**
 * 本期允许出现的 arXiv id 白名单（去版本号）。
 * 只收 host 确实是 arxiv.org 的输入——canonicalArxivId 的正则未锚定 host，
 * 任何路径里撞上 `\d{4}\.\d{4,5}` 的第三方链接都会被它认成 arXiv id，
 * 直接喂进来会把白名单撑松（见 lib/arxiv.ts isArxivLink 的同款告诫）。
 */
export function buildAllowedArxivIds(
  urls: Array<string | null | undefined>,
): Set<string> {
  const ids = new Set<string>();
  for (const url of urls) {
    if (!url || !isArxivUrl(url)) continue;
    const id = canonicalArxivId(url);
    if (id) ids.add(id);
  }
  return ids;
}

/** 文本里出现的全部 URL（markdown 链接目标 + 裸链），去重保序 */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.match(BARE_URL_RE) ?? []) {
    const url = trimTrailingPunct(raw);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export interface LinkViolations {
  /** arxiv.org 链接但不在本期供给集内 —— 模型编的（往期 pick 配链接时必然瞎编） */
  fabricatedArxiv: string[];
  /** exa.ai 内部页 */
  exa: string[];
}

/**
 * 链接校验：每个 arxiv.org 链接必须 ∈ 本期候选 ∪ 往期 picks（按去版本号的 arXiv id
 * 比较）；exa.ai 一律违规。非 arXiv 的第三方链接不设限——它们来自 web_search，
 * 是 prompt 明确要求的引用来源。
 */
export function collectLinkViolations(
  texts: string[],
  allowedArxivIds: Set<string>,
): LinkViolations {
  const fabricatedArxiv: string[] = [];
  const exa: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    for (const url of extractUrls(text)) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (isExaUrl(url)) {
        exa.push(url);
        continue;
      }
      if (!isArxivUrl(url)) continue;
      const id = canonicalArxivId(url);
      // id 解析不出的 arxiv.org 链接（列表页/搜索页等）同样不是候选，一并降级
      if (!id || !allowedArxivIds.has(id)) fabricatedArxiv.push(url);
    }
  }
  return { fabricatedArxiv, exa };
}

/**
 * 把命中的 markdown 链接降级为纯文本：`[标题](url)` → `标题`。
 * 只处理 MD_LINK_RE 覆盖的 inline 形态（引用式/自动链接不动，图片会留下 `!`）；
 * 裸链一律保持原样——改写裸链等于改写正文措辞，只留痕不动手。
 */
export function demoteMarkdownLinks(
  md: string,
  shouldDemote: (url: string) => boolean,
): string {
  return md.replace(MD_LINK_RE, (full, text: string, url: string) =>
    shouldDemote(trimTrailingPunct(url)) ? text : full,
  );
}

/** 缺失的固定小节标题（`## 本期看点` 必须是正文首个非空行，`## 未解之问` 必须存在） */
export function findMissingSections(content: string): string[] {
  const missing: string[] = [];
  const firstLine =
    content
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  if (firstLine !== SECTION_LEAD) missing.push(SECTION_LEAD);
  // 与首节判据同样容忍缩进：模型偶尔会给小节标题带前导空格
  if (!new RegExp(`^\\s*${SECTION_OPEN_QUESTIONS}\\s*$`, "m").test(content)) {
    missing.push(SECTION_OPEN_QUESTIONS);
  }
  return missing;
}

/** 命中的内部措辞（保序去重，返回词表原形） */
export function findInternalWording(texts: string[]): string[] {
  const hits: string[] = [];
  const joined = texts.join("\n");
  for (const term of INTERNAL_WORDING_TERMS) {
    if (joined.toLowerCase().includes(term.toLowerCase())) hits.push(term);
  }
  return hits;
}

/** 去掉标题里的期号前缀（双重期号）。无前缀时原样 trim 返回 */
export function stripIssuePrefix(title: string): string {
  return title.replace(ISSUE_PREFIX_RE, "").trim();
}

/**
 * 「本周/这周」→「本期」。这一项**不进重试判据**：它是纯确定性改写，
 * 让强模型为它重跑一次 8 步 agent 循环不划算，而且整篇重写可能修好措辞
 * 却新编一个 arXiv 链接。出口无条件跑一次即可。
 */
export function replaceWeeklyWording(text: string): string {
  return text.replace(new RegExp(WEEKLY_WORDING_RE.source, "g"), "本期");
}

export type SynthesisIssue =
  | { type: "internal_ref"; sample: string }
  | { type: "fabricated_arxiv"; urls: string[] }
  | { type: "exa_link"; urls: string[] }
  | { type: "missing_sections"; missing: string[] }
  | { type: "internal_wording"; terms: string[] };

/**
 * 出口全检（content + 全部 recommendationNote），返回的每一项都值得为它重跑一次
 * 定稿——只有模型才能修的问题才进这里。返回空数组即放行。
 *
 * 两类确定性改写刻意不进来：标题期号（无条件 stripIssuePrefix）与「本周」
 * （无条件 replaceWeeklyWording）。代码几个字符就能修好的事，不值得多烧一次
 * 强模型调用，更不值得冒「整篇重写把别处改坏」的风险。
 */
export function collectSynthesisIssues(input: {
  content: string;
  notes: string[];
  allowedArxivIds: Set<string>;
}): SynthesisIssue[] {
  const texts = [input.content, ...input.notes];
  const issues: SynthesisIssue[] = [];

  // 内部记号在推荐语里同样穿帮，content 与 notes 一起扫
  const ref = texts.map((t) => t.match(INTERNAL_REF_RE)).find(Boolean);
  if (ref) issues.push({ type: "internal_ref", sample: ref[0] });

  const links = collectLinkViolations(texts, input.allowedArxivIds);
  if (links.fabricatedArxiv.length > 0) {
    issues.push({ type: "fabricated_arxiv", urls: links.fabricatedArxiv });
  }
  if (links.exa.length > 0) issues.push({ type: "exa_link", urls: links.exa });

  const missing = findMissingSections(input.content);
  if (missing.length > 0) issues.push({ type: "missing_sections", missing });

  const terms = findInternalWording(texts);
  if (terms.length > 0) issues.push({ type: "internal_wording", terms });

  return issues;
}

/**
 * 把违规清单渲染成重试用的 extraSystem。所有问题合并成**一次**重试而不是各来一次：
 * 定稿走强模型 + 8 步 agent 循环，逐条串行重试的代价（钱与 step 超时风险）远大于收益。
 */
export function buildRetryInstruction(issues: SynthesisIssue[]): string {
  const lines = ["Your previous draft violated these hard rules. Rewrite it:"];
  for (const issue of issues) {
    switch (issue.type) {
      case "internal_ref":
        lines.push(
          `- It referenced an item by an internal code ("${issue.sample}") that readers cannot resolve. Use inline markdown links [标题](URL) only; to point at a past issue write 「第 N 期的 X」, never "[#N]" / "#N 期" / "上期 #N".`,
        );
        break;
      case "fabricated_arxiv":
        lines.push(
          `- These arxiv.org links are NOT in the material provided and appear to be invented: ${issue.urls.join(", ")}. Every arxiv.org link must be copied verbatim from a candidate's URL line or from a prior pick's URL. If you have no URL for a paper, name it in plain text without a link.`,
        );
        break;
      case "exa_link":
        lines.push(
          `- These links point at exa.ai search-tool pages, which are not real sources: ${issue.urls.join(", ")}. Link the primary source instead, or drop the link.`,
        );
        break;
      case "missing_sections":
        lines.push(
          `- The body is missing the required section heading(s) ${issue.missing.join(", ")}, written exactly like that. content must start with "${SECTION_LEAD}" and contain "${SECTION_OPEN_QUESTIONS}".`,
        );
        break;
      case "internal_wording":
        lines.push(
          `- It leaked internal pipeline wording (${issue.terms.join(", ")}) into reader-facing text. Never mention author signals, missing full text, thin abstracts, draft notes or risk flags — judge the work, describe only the work.`,
        );
        break;
    }
  }
  return lines.join("\n");
}
