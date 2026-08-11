/**
 * 「在途」状态集合:从上传到出结果之间的所有状态。
 * pending 也算 —— 论文从入库到队列消费者取走都停在 pending,积压时可能很久,
 * 对用户来说它就是「正在处理」。SSE 推送、列表「处理中」筛选、状态计数三处
 * 必须用同一个集合,否则会出现「chip 显示 1 篇但点进去列表是空的」。
 */
export const IN_FLIGHT_PAPER_STATUSES = [
  "pending",
  "parsing",
  "processing_text",
  "processing_image",
] as const;

export type InFlightPaperStatus = (typeof IN_FLIGHT_PAPER_STATUSES)[number];

export function isInFlightPaperStatus(
  status: string,
): status is InFlightPaperStatus {
  return (IN_FLIGHT_PAPER_STATUSES as readonly string[]).includes(status);
}
