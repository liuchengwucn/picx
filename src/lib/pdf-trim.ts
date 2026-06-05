/**
 * 上传前的「论文尾部」裁剪 —— 浏览器端运行,在不经 MinerU 的情况下定位参考文献/附录
 * 起始页并按页 subset,减轻 MinerU 解析负担(也省额度)。
 *
 * 分工:文本提取复用项目已有的 `pdfjs-serverless`(summary 流水线同款),按页裁剪用
 * `pdf-lib`;标题模式复用 `paper-tail.ts`(与服务端单一真源)。两个重依赖都在调用处
 * 动态 import,不进主包、不影响首屏。
 *
 * 这是启发式且有意「偏安全」:命中页连同其上方可能的正文一并保留(keptPages 含命中页),
 * 宁可少裁也不误删正文;最终是否裁剪由用户在预览里决定。
 */

import {
  matchesPaperTailHeading,
  normalizeHeadingCandidate,
} from "./paper-tail";

export interface TrimPlan {
  /** PDF 总页数 */
  totalPages: number;
  /** 命中尾部标题所在页(1-based) */
  cutPageNumber: number;
  /** 将上传的页数(= cutPageNumber,含命中页以防误删正文) */
  keptPages: number;
  /** 裁掉的页数 */
  droppedPages: number;
  /** 命中的标题原文(用于预览展示) */
  headingText: string;
}

// 参考文献/附录几乎都在文档后段:只扫后 ~55% 以省时,并避免正文里的零星词误判。
const SCAN_FROM_RATIO = 0.45;
// 太短的 PDF(幻灯片、单页说明等)不值得裁。
const MIN_TOTAL_PAGES = 4;

type TextItem = { str?: string; hasEOL?: boolean };

/** 把一页的文本项重建为带换行的纯文本,供按行做标题判定。 */
function reconstructPageText(items: TextItem[]): string {
  const chunks: string[] = [];
  for (const item of items) {
    if (typeof item.str === "string") {
      const value = item.str.replace(/\0/g, "").trim();
      if (value.length > 0) {
        chunks.push(value);
      }
      chunks.push(item.hasEOL ? "\n" : " ");
    }
  }
  return chunks
    .join("")
    .replace(/[ \t\u00a0\u3000]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/**
 * 分析 PDF,若在后段找到尾部标题且其后还有可裁的页,返回裁剪方案;否则返回 null。
 * 失败由调用方兜底为「上传完整版」。
 */
export async function analyzePdfForTrim(
  data: ArrayBuffer,
): Promise<TrimPlan | null> {
  const { getDocument } = await import("pdfjs-serverless");
  // 传副本:pdfjs 可能会接管/分离底层 buffer,避免影响调用方后续复用。
  const pdf = await getDocument({
    data: new Uint8Array(data.slice(0)),
    useSystemFonts: true,
  }).promise;

  try {
    const total = pdf.numPages;
    if (total < MIN_TOTAL_PAGES) {
      return null;
    }

    const startPage = Math.max(2, Math.floor(total * SCAN_FROM_RATIO) + 1);

    for (let pageNumber = startPage; pageNumber <= total; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = reconstructPageText(textContent.items as TextItem[]);

      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        if (matchesPaperTailHeading(normalizeHeadingCandidate(trimmed))) {
          // 命中页在最后一页 → 裁了等于没裁,放弃。
          if (pageNumber >= total) {
            return null;
          }
          return {
            totalPages: total,
            cutPageNumber: pageNumber,
            keptPages: pageNumber,
            droppedPages: total - pageNumber,
            headingText: trimmed.slice(0, 80),
          };
        }
      }
    }

    return null;
  } finally {
    // 释放 pdfjs 资源。
    await pdf.destroy().catch(() => {});
  }
}

/**
 * 保留前 keepUpToPage 页生成新 PDF 字节。加密/损坏等导致失败时抛出,由调用方兜底。
 */
export async function trimPdfToPages(
  data: ArrayBuffer,
  keepUpToPage: number,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(data, { ignoreEncryption: false });
  const pageCount = src.getPageCount();
  const keep = Math.max(1, Math.min(keepUpToPage, pageCount));

  const out = await PDFDocument.create();
  const indices = Array.from({ length: keep }, (_, i) => i);
  const copied = await out.copyPages(src, indices);
  for (const page of copied) {
    out.addPage(page);
  }
  return out.save();
}
