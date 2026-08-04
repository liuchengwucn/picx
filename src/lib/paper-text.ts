/**
 * 论文全文在 R2 的落盘约定。写入方：queue-consumer（新论文）与
 * scripts/backfill-paper-text.mjs（存量）。读取方：chatbot 的 readPaper 工具。
 * 存 rawText（未裁剪，含参考文献），chatbot 需要能回答引文相关问题。
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
