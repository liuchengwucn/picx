/**
 * 密集行右端那 46px 只放得下 MM-DD。年份由分组标题或 title 属性补足。
 * 用本地时区：这个串是给人看的，不是给机器对齐时间轴。
 */
export function shortMonthDay(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
