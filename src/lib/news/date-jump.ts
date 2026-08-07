/** YYYY-MM-DD → 本地时区当天零点 Date；分量越界（2026-02-30 等）返回 null。 */
export function dateFromKey(dateKey: string): Date | null {
  const mch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!mch) return null;
  const y = Number(mch[1]);
  const mo = Number(mch[2]);
  const day = Number(mch[3]);
  const d = new Date(y, mo - 1, day);
  // Date 构造对越界分量静默进位，round-trip 校验拦截
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/**
 * 把访客本地时区语义的 YYYY-MM-DD 换算为「次日 00:00 本地时间」的
 * epoch 毫秒，作为 keyset 上界（服务端谓词 sortCol < beforeTs）。
 * 恰压次日零点的条目属于次日，被 shortId < "" 恒假排除，语义正确。
 */
export function beforeTsOf(dateKey: string): number | null {
  const d = dateFromKey(dateKey);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}
