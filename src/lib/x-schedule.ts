/** 从 base（ms）起，按 intervalMinutes 等间隔生成 count 个时间戳（ms）。 */
export function computeScheduleTimes(
  count: number,
  baseMs: number,
  intervalMinutes: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(baseMs + i * intervalMinutes * 60_000);
  }
  return out;
}

/** 防洪用：now（ms）往前 windowHours 小时的时间戳（ms）。 */
export function recentSinceMs(nowMs: number, windowHours: number): number {
  return nowMs - windowHours * 3_600_000;
}
