import { getDocument } from "pdfjs-serverless";

export interface PDFMetadata {
  pageCount: number;
  text: string;
  title?: string;
}

/**
 * 从 PDF 文件中提取文本内容
 *
 * @param pdfData PDF 文件的 ArrayBuffer 数据
 * @returns 包含页数和文本内容的对象
 * @throws 如果提取失败则抛出错误
 */
export async function extractPDFText(
  pdfData: ArrayBuffer,
): Promise<PDFMetadata> {
  try {
    const pdf = await getDocument({
      data: new Uint8Array(pdfData),
      useSystemFonts: true,
    }).promise;

    const textParts: string[] = [];
    const numPages = pdf.numPages;

    // 尝试从PDF元数据获取标题
    let title: string | undefined;
    try {
      const metadata = await pdf.getMetadata();
      if (metadata?.info?.Title && typeof metadata.info.Title === "string") {
        title = metadata.info.Title.trim();
      }
    } catch (e) {
      console.warn("Failed to extract PDF metadata:", e);
    }

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item) => {
          if ("str" in item) {
            return item.str;
          }
          return "";
        })
        .join(" ");

      textParts.push(pageText);
    }

    const fullText = textParts.join("\n\n");

    if (!fullText.trim()) {
      throw new Error("No text content extracted from PDF");
    }

    return {
      pageCount: numPages,
      text: fullText,
      title,
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
    // 从 arXiv URL 提取论文 ID
    // 支持格式: https://arxiv.org/abs/2301.00001 或 https://arxiv.org/pdf/2301.00001.pdf
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
