/**
 * 日期列固定 46px,所以只显示 MM-DD。年份由月份分组标题给出;搜索/筛选时分组
 * 关闭、年份丢失,用 title 属性兜底(hover 显示完整本地化日期)。
 * 用本地时区：这个串是给人看的，不是给机器对齐时间轴。
 */
export function shortMonthDay(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
