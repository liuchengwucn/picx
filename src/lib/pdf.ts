import { getDocument } from "pdfjs-serverless";

import type { AIConfig } from "./ai";
import { reviewPaperTailCandidate } from "./ai";

const MIN_MAIN_TEXT_CHARS = 200;
const PAPER_TAIL_REVIEW_CONFIDENCE_THRESHOLD = 0.75;
const PREVIOUS_CONTEXT_CHARS = 1200;
const CANDIDATE_CONTEXT_CHARS = 1200;
const NEXT_CONTEXT_CHARS = 2400;
const MAX_CANDIDATE_LINE_LENGTH = 120;

interface ExtractedPDFPage extends PDFPageText {
  startOffset: number;
}

interface PaperTailCandidate {
  title: string;
  pageNumber: number;
  globalIndex: number;
}

export interface PDFPageText {
  pageNumber: number;
  text: string;
}

export interface PaperTailTrimMetadata {
  applied: boolean;
  confidence?: number;
  cutFromPage?: number;
  cutFromText?: string;
}

export interface PDFMetadata {
  pageCount: number;
  text: string;
  rawText: string;
  mainText: string;
  title?: string;
  tailTrim: PaperTailTrimMetadata;
  pages: PDFPageText[];
}

export class PDFPageLimitError extends Error {
  readonly pageCount: number;
  readonly maxPages: number;

  constructor(pageCount: number, maxPages: number) {
    super(
      `PDF has ${pageCount} pages, exceeding the limit of ${maxPages} pages`,
    );
    this.name = "PDFPageLimitError";
    this.pageCount = pageCount;
    this.maxPages = maxPages;
  }
}

function normalizePageText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v\u00a0\u3000]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeHeadingCandidate(line: string): string {
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

function matchesPaperTailHeading(normalizedLine: string): boolean {
  if (!normalizedLine || normalizedLine.length > MAX_CANDIDATE_LINE_LENGTH) {
    return false;
  }

  const patterns = [
    /^(references|reference)$/iu,
    /^(bibliography|references and notes)$/iu,
    /^(appendix|appendices)(?:\s+[a-z0-9]+)?$/iu,
    /^(supplementary|supplemental)(?:\s+(?:material|materials|information|appendix|appendices))?$/iu,
    /^(acknowledg?ments?)$/iu,
    /^(author contributions?)$/iu,
    /^(conflicts? of interest|competing interests?)$/iu,
    /^(data availability|ethics statement)$/iu,
    /^(参考文献|附录|附錄|致谢|致謝|作者贡献|作者貢獻)$/u,
    /^(付録|補遺|補足資料|補足情報|謝辞|著者貢献|利益相反|データ可用性|倫理声明)(?:\s*[a-z0-9一二三四五六七八九十]+)?$/u,
  ];

  return patterns.some((pattern) => pattern.test(normalizedLine));
}

function extractPageTextFromItems(
  items: Array<{ str?: string; hasEOL?: boolean }>,
): string {
  const chunks: string[] = [];

  for (const item of items) {
    if (typeof item.str === "string") {
      const value = item.str.replaceAll("\0", "").trim();

      if (value.length > 0) {
        chunks.push(value);
      }

      chunks.push(item.hasEOL ? "\n" : " ");
    }
  }

  return normalizePageText(chunks.join(""));
}

function shouldMergeHyphenatedWord(
  previousText: string,
  nextText: string,
): boolean {
  return /[A-Za-z]-$/.test(previousText) && /^[a-z]/.test(nextText);
}

function joinPagesContinuously(pageTexts: string[]): {
  rawText: string;
  startOffsets: number[];
} {
  const startOffsets: number[] = [];
  let rawText = "";

  for (const pageText of pageTexts) {
    const normalizedPageText = normalizePageText(pageText);

    if (!normalizedPageText) {
      startOffsets.push(rawText.length);
      continue;
    }

    if (!rawText) {
      startOffsets.push(0);
      rawText = normalizedPageText;
      continue;
    }

    if (shouldMergeHyphenatedWord(rawText, normalizedPageText)) {
      rawText = rawText.slice(0, -1);
      startOffsets.push(rawText.length);
      rawText += normalizedPageText;
      continue;
    }

    rawText += " ";
    startOffsets.push(rawText.length);
    rawText += normalizedPageText;
  }

  return {
    rawText,
    startOffsets,
  };
}

function collectPaperTailCandidates(
  pages: ExtractedPDFPage[],
): PaperTailCandidate[] {
  const candidates: PaperTailCandidate[] = [];

  for (const page of pages) {
    const lines = page.text.split("\n");
    let cursor = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      const localLineStart = cursor + line.search(/\S|$/);
      cursor += line.length + 1;

      if (!trimmedLine) {
        continue;
      }

      const normalizedTitle = normalizeHeadingCandidate(trimmedLine);

      if (!matchesPaperTailHeading(normalizedTitle)) {
        continue;
      }

      candidates.push({
        title: trimmedLine,
        pageNumber: page.pageNumber,
        globalIndex: page.startOffset + localLineStart,
      });
    }
  }

  return candidates;
}

function buildTailReviewContexts(rawText: string, globalIndex: number) {
  const previousContext = rawText
    .slice(Math.max(0, globalIndex - PREVIOUS_CONTEXT_CHARS), globalIndex)
    .trim();
  const candidateContext = rawText
    .slice(
      globalIndex,
      Math.min(rawText.length, globalIndex + CANDIDATE_CONTEXT_CHARS),
    )
    .trim();
  const nextContext = rawText
    .slice(
      Math.min(rawText.length, globalIndex + CANDIDATE_CONTEXT_CHARS),
      Math.min(
        rawText.length,
        globalIndex + CANDIDATE_CONTEXT_CHARS + NEXT_CONTEXT_CHARS,
      ),
    )
    .trim();

  return {
    previousContext,
    candidateContext,
    nextContext,
  };
}

async function trimPaperTail(
  rawText: string,
  pages: ExtractedPDFPage[],
  aiConfig: AIConfig,
): Promise<{ mainText: string; tailTrim: PaperTailTrimMetadata }> {
  const candidates = collectPaperTailCandidates(pages);

  if (candidates.length === 0) {
    return {
      mainText: rawText,
      tailTrim: {
        applied: false,
      },
    };
  }

  for (const candidate of candidates) {
    const contexts = buildTailReviewContexts(rawText, candidate.globalIndex);
    const review = await reviewPaperTailCandidate(
      {
        candidateTitle: candidate.title,
        pageNumber: candidate.pageNumber,
        totalPages: pages.length,
        previousContext: contexts.previousContext,
        candidateContext: contexts.candidateContext,
        nextContext: contexts.nextContext,
      },
      aiConfig,
    );

    if (
      !review.cut ||
      review.confidence < PAPER_TAIL_REVIEW_CONFIDENCE_THRESHOLD
    ) {
      continue;
    }

    const mainText = rawText.slice(0, candidate.globalIndex).trim();

    if (mainText.length < MIN_MAIN_TEXT_CHARS) {
      return {
        mainText: rawText,
        tailTrim: {
          applied: false,
        },
      };
    }

    return {
      mainText,
      tailTrim: {
        applied: true,
        confidence: review.confidence,
        cutFromPage: candidate.pageNumber,
        cutFromText: candidate.title,
      },
    };
  }

  return {
    mainText: rawText,
    tailTrim: {
      applied: false,
    },
  };
}

/**
 * 从 PDF 文件中提取文本内容
 *
 * @param pdfData PDF 文件的 ArrayBuffer 数据
 * @param maxPages 最大页数限制，默认 150 页
 * @param aiConfig 可选的 AI 配置，用于裁剪参考文献和附录等尾部内容
 * @returns 包含页数和文本内容的对象
 * @throws 如果提取失败或超出页数限制则抛出错误
 */
export async function extractPDFText(
  pdfData: ArrayBuffer,
  maxPages = 150,
  aiConfig?: AIConfig,
): Promise<PDFMetadata> {
  try {
    const pdf = await getDocument({
      data: new Uint8Array(pdfData),
      useSystemFonts: true,
    }).promise;

    const numPages = pdf.numPages;

    if (numPages > maxPages) {
      throw new PDFPageLimitError(numPages, maxPages);
    }

    let title: string | undefined;

    try {
      const metadata = await pdf.getMetadata();
      if (metadata?.info?.Title && typeof metadata.info.Title === "string") {
        title = metadata.info.Title.trim();
      }
    } catch (e) {
      console.warn("Failed to extract PDF metadata:", e);
    }

    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = extractPageTextFromItems(
        textContent.items as Array<{ str?: string; hasEOL?: boolean }>,
      );
      pageTexts.push(pageText);
    }

    const { rawText, startOffsets } = joinPagesContinuously(pageTexts);

    if (!rawText.trim()) {
      throw new Error("No text content extracted from PDF");
    }

    const pages: ExtractedPDFPage[] = pageTexts.map((text, index) => ({
      pageNumber: index + 1,
      text,
      startOffset: startOffsets[index] ?? 0,
    }));

    let mainText = rawText;
    let tailTrim: PaperTailTrimMetadata = {
      applied: false,
    };

    if (aiConfig) {
      try {
        const trimmed = await trimPaperTail(rawText, pages, aiConfig);
        mainText = trimmed.mainText;
        tailTrim = trimmed.tailTrim;
      } catch (error) {
        console.warn(
          "Failed to trim paper tail, falling back to full text:",
          error,
        );
      }
    }

    return {
      pageCount: numPages,
      text: mainText,
      rawText,
      mainText,
      title,
      tailTrim,
      pages: pages.map(({ pageNumber, text }) => ({
        pageNumber,
        text,
      })),
    };
  } catch (error) {
    console.error("Failed to extract PDF text:", error);
    throw new Error(
      `PDF text extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 从 arXiv URL 下载 PDF 文件
 *
 * @param arxivUrl arXiv 论文 URL (例如: https://arxiv.org/abs/2301.00001)
 * @returns PDF 文件的 ArrayBuffer 数据
 * @throws 如果下载失败则抛出错误
 */
export async function downloadArxivPDF(arxivUrl: string): Promise<ArrayBuffer> {
  try {
    const arxivIdMatch = arxivUrl.match(/arxiv\.org\/(abs|pdf)\/([0-9.]+)/);
    if (!arxivIdMatch) {
      throw new Error("Invalid arXiv URL format");
    }

    const arxivId = arxivIdMatch[2];
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;

    console.log(`Downloading PDF from: ${pdfUrl}`);

    const response = await fetch(pdfUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to download PDF: ${response.status} ${response.statusText}`,
      );
    }

    const contentType = response.headers.get("content-type");
    if (contentType && !contentType.includes("application/pdf")) {
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      throw new Error("Downloaded PDF is empty");
    }

    console.log(`Successfully downloaded PDF: ${arrayBuffer.byteLength} bytes`);

    return arrayBuffer;
  } catch (error) {
    console.error("Failed to download arXiv PDF:", error);
    throw new Error(
      `arXiv PDF download failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
