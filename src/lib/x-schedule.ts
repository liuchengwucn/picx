/** 防洪用：now（ms）往前 windowHours 小时的时间戳（ms）。 */
export function recentSinceMs(nowMs: number, windowHours: number): number {
  return nowMs - windowHours * 3_600_000;
}
