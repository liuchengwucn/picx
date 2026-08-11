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

/**
 * 判断用户输入是否指向 arXiv。是则走服务端下载 + canonical 去重路径，否则走通用 PDF 抓取。
 *
 * 不能直接用 canonicalArxivId 判断：它的正则 `(\d{4}\.\d{4,5})` 未锚定也不校验 host,
 * 任何路径里撞上该形状数字的第三方链接都会被误判成 arXiv, 从而导入一篇不相干的论文、
 * 或把捏造的 source_url 写进 canonical 去重索引。所以:
 * - 整串就是一个 arXiv id(新格式或旧格式)-> 是
 * - 否则一律解析出 hostname 后按 arxiv.org 判定; 没有 scheme 就补 https:// 再解析,
 *   绝不退化成裸正则匹配
 */
export function isArxivLink(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  // 裸 arXiv id: 整串就是 id(新格式 2601.13209v2 / 旧格式 hep-th/9901001)。
  // 必须先于补 scheme 重解析 —— new URL("https://2301.12345") 能解析成功,
  // 且 hostname 就是 "2301.12345", 会被 arxiv.org 判定错杀。
  if (
    /^(\d{4}\.\d{4,5}(v\d+)?|[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?)$/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  let host: string;
  try {
    host = new URL(trimmed).hostname;
  } catch {
    // 无 scheme(用户直接粘 "arxiv.org/abs/…" 或 "example.com/x.pdf"):
    // 补上再解析, 仍按 host 判定。
    try {
      host = new URL(`https://${trimmed}`).hostname;
    } catch {
      return false;
    }
  }
  return /(^|\.)arxiv\.org$/i.test(host) && canonicalArxivId(trimmed) !== null;
}
