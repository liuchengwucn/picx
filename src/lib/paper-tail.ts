/**
 * 论文尾部(参考文献 / 附录 / 致谢 / 补充材料等)标题识别 —— 纯字符串工具,
 * 无 pdfjs / AI 依赖,故服务端与浏览器端均可引用。
 *
 * 唯一消费方是 summary 流水线(src/lib/pdf.ts,服务端,裁剪喂给 LLM 的文本)。
 * 独立成文件是为了让标题模式可单测、且不牵连 pdfjs 依赖。
 */

export const MAX_CANDIDATE_LINE_LENGTH = 120;

/**
 * 把一行候选标题归一化:统一全角/连字符/空白,剥掉两端括号、列表符号、行尾标点,
 * 以及「第X章」「Section X」「1.2.3」等前缀编号,便于后续与尾部标题模式精确比对。
 */
export function normalizeHeadingCandidate(line: string): string {
  let normalized = line
    .normalize("NFKC")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[ \t\u00a0\u3000]+/g, " ")
    .trim();

  normalized = normalized.replace(/^[[(【（「『]+/, "");
  normalized = normalized.replace(/[\])】）」』]+$/, "");
  normalized = normalized.replace(/^[#*\-–—]+\s*/, "");
  normalized = normalized.replace(/[：:;,.\-–—]+$/, "").trim();
  normalized = normalized.replace(
    /^第\s*[0-9ivxlcdm一二三四五六七八九十百千]+\s*[章节節部]\s*/iu,
    "",
  );
  normalized = normalized.replace(
    /^(?:section|sec\.?|chapter|part)\s+[0-9ivxlcdm]+[.:：-]?\s*/iu,
    "",
  );
  normalized = normalized.replace(
    /^[0-9ivxlcdm]+(?:\.[0-9ivxlcdm]+)*[)\].:：-]?\s*/iu,
    "",
  );

  return normalized.trim();
}

/**
 * 判断归一化后的标题是否属于「正文之后」的尾部章节(参考文献 / 附录 / 致谢 /
 * 补充材料 / 作者贡献 / 利益冲突 / 数据可用性 / 伦理声明等),覆盖中英日。
 */
export function matchesPaperTailHeading(normalizedLine: string): boolean {
  if (!normalizedLine || normalizedLine.length > MAX_CANDIDATE_LINE_LENGTH) {
    return false;
  }

  const patterns = [
    /^(references|reference)$/iu,
    /^(bibliography|references and notes)$/iu,
    /^(appendix|appendices)(?:\s+[a-z0-9]+)?$/iu,
    /^(supplementary|supplemental)(?:\s+(?:material|materials|information|appendix|appendices))?$/iu,
    /^(acknowledge?ments?)$/iu,
    /^(author contributions?)$/iu,
    /^(conflicts? of interest|competing interests?)$/iu,
    /^(data availability|ethics statement)$/iu,
    /^(参考文献|附录|附錄|致谢|致謝|作者贡献|作者貢獻)$/u,
    /^(付録|補遺|補足資料|補足情報|謝辞|著者貢献|利益相反|データ可用性|倫理声明)(?:\s*[a-z0-9一二三四五六七八九十]+)?$/u,
  ];

  return patterns.some((pattern) => pattern.test(normalizedLine));
}
