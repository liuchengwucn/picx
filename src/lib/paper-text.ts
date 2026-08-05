/**
 * 论文全文在 R2 的落盘约定。写入方：queue-consumer（新论文）与
 * scripts/backfill-paper-text.mjs（存量）。读取方：chatbot 的 readPaper 工具。
 * 存 rawText（未裁剪，含参考文献），chatbot 需要能回答引文相关问题。
 *
 * 注意格式已按提取路径分叉：MinerU 路径存的是「剥掉图片引用的 markdown 文本」
 * （保留表格与公式），pdfjs 回退路径存的是 pdfjs 抽出的纯文本。两者都是给 LLM
 * 读的自然语言，消费方无需区分，但不要假设内容里没有 markdown 记号。
 */
export function paperTextKey(paperId: string): string {
  return `paper-text/${paperId}.txt`;
}

export async function loadPaperText(
  bucket: R2Bucket,
  paperId: string,
): Promise<string | null> {
  const obj = await bucket.get(paperTextKey(paperId));
  return obj ? await obj.text() : null;
}
