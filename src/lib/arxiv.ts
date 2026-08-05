// HuggingFace Daily Papers API：arxiv-cron（阈值判断）与 agent.ts 的
// listDailyPapers 工具共用同一个 endpoint 常量。
export const HF_DAILY_PAPERS_API = "https://huggingface.co/api/daily_papers";

/**
 * arXiv 论文 URL 规范化。
 *
 * gallery 去重(应用层查重 + DB 层 partial unique index)都以「规范化后的
 * source_url」为唯一身份键。为保证两层用的是同一个值, 论文在写入时就应存这个
 * canonical 形式, 否则 http/https、abs/pdf、版本号 vN 等差异会导致同一篇论文
 * 被判成不同论文。
 *
 * 统一规则:
 * - 去掉协议、域名、abs/pdf 路径、.pdf 后缀
 * - 去掉版本号后缀(如 2601.13209v2 -> 2601.13209)
 * - 输出 `https://arxiv.org/abs/{id}`
 *
 * 支持新格式 id(YYMM.NNNNN)与旧格式(如 hep-th/9901001)。
 * 无法识别时原样返回 trim 后的输入(让调用方自行决定如何处理)。
 */
export function canonicalArxivUrl(idOrUrl: string): string {
  const id = canonicalArxivId(idOrUrl);
  return id ? `https://arxiv.org/abs/${id}` : idOrUrl.trim();
}

/**
 * 从 arXiv id 或 URL 中抽取规范化的 arXiv id(去版本号)。识别不到返回 null。
 */
export function canonicalArxivId(idOrUrl: string): string | null {
  const raw = idOrUrl.trim();

  // 新格式: 2601.13209 / 2601.13209v2 (可能带 abs/pdf 路径或 .pdf 后缀)
  const modern = raw.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  if (modern) {
    return modern[1];
  }

  // 旧格式: archive/YYMMNNN, 如 hep-th/9901001 (可能带版本号)
  const legacy = raw.match(/([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i);
  if (legacy) {
    return legacy[1];
  }

  return null;
}
