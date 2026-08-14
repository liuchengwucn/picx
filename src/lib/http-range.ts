/**
 * HTTP `Range` 请求头解析与 R2 区间读取的互转（只支持单区间的 bytes 单位，够 pdf.js 用）。
 *
 * 刻意不做「把 suffix 换算成 offset」：换算需要先知道对象总大小，而 R2 的
 * `bucket.get(key, { range: { suffix } })` 原生支持后缀区间，多一次 head 请求纯属浪费。
 * 多区间（`bytes=0-9,20-29`）返回 invalid —— 回退成 200 全量响应永远是合法降级，
 * 而拼 multipart/byteranges 没有调用方需要。
 */
export type ParsedRange =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "offset"; offset: number; length?: number }
  | { kind: "suffix"; suffix: number };

// range unit 按 RFC 是大小写不敏感的（`Bytes=0-9` 合法）
const RANGE_RE = /^bytes=(\d*)-(\d*)$/i;

export function parseRangeHeader(header: string | null): ParsedRange {
  if (!header) return { kind: "none" };

  const match = RANGE_RE.exec(header.trim());
  if (!match) return { kind: "invalid" };

  const [, rawStart, rawEnd] = match;

  // 一律要求是安全整数：`bytes=99999999999999999999-` 这种溢出值传给 R2 会在
  // C++ 层被强转成 0，于是「从 1e20 开始」变成一个宣称 `bytes 0-35/36` 的 206 ——
  // 服务端对客户端说了谎。挡在这里，让它降级成诚实的 200 全量。
  // （前导零不受影响：`000…005` 仍然是安全整数 5。）

  // `bytes=-N`：最后 N 字节
  if (rawStart === "") {
    if (rawEnd === "") return { kind: "invalid" };
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      return { kind: "invalid" };
    return { kind: "suffix", suffix };
  }

  const offset = Number(rawStart);
  if (!Number.isSafeInteger(offset)) return { kind: "invalid" };

  // `bytes=N-`：从 N 到末尾
  if (rawEnd === "") return { kind: "offset", offset };

  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < offset) return { kind: "invalid" };
  return { kind: "offset", offset, length: end - offset + 1 };
}

/** 把解析结果翻译成 `bucket.get` 的 range 选项；none/invalid 都表示「别带区间」。 */
export function toR2Range(parsed: ParsedRange): R2Range | undefined {
  if (parsed.kind === "suffix") return { suffix: parsed.suffix };
  if (parsed.kind !== "offset") return undefined;
  return parsed.length === undefined
    ? { offset: parsed.offset }
    : { offset: parsed.offset, length: parsed.length };
}

/**
 * R2 在区间读取后回填的 `range` 运行时总是 `{ offset, length }` 完整形态（请求的末端
 * 超出对象大小时 length 会被夹到实际长度，suffix 也已换算成 offset），但它的静态类型
 * 是三选一联合，得先收窄才能取字段。
 *
 * 千万别用 `"suffix" in range` 来判别：workerd 回填的对象上 offset/length/suffix
 * 三个键**都存在**，用不上的那个值是 undefined，`in` 恒为真——照着类型写会让区间分支
 * 整个失效（响应退回 200 却只带部分 body）。只能按值判断，而且必须跟 undefined 比，
 * 不能用真值判断：`offset === 0` 是最常见的区间，正是首个分片。
 */
export function servedRange(
  range: R2Range | undefined,
): { offset: number; length: number } | undefined {
  const { offset, length } = (range ?? {}) as Partial<{
    offset: number;
    length: number;
    suffix: number;
  }>;
  if (offset === undefined || length === undefined) return undefined;
  return { offset, length };
}
