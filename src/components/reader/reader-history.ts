export interface ReaderHistorySource {
  kind: "upload" | "url";
  name: string;
  url?: string;
}

export interface ReaderHistoryEntry {
  id: string;
  userId: string;
  title: string;
  markdown: string;
  source: ReaderHistorySource;
  createdAt: number;
  lastReadAt: number;
  sizeBytes: number;
}

export interface RecordInput {
  id: string;
  userId: string;
  title: string;
  markdown: string;
  source: ReaderHistorySource;
  now: number;
}

/** 历史总字节预算;超出按 LRU 淘汰。 */
export const HISTORY_BUDGET_BYTES = 150 * 1024 * 1024;

/** 字符串的 UTF-8 字节长度。 */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 字节的 SHA-256,返回 64 位小写十六进制。 */
export async function hashBytes(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  const view =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes as ArrayBuffer);
  // crypto.subtle 需要 ArrayBuffer 视图;切片确保是独立 ArrayBuffer。
  const digest = await crypto.subtle.digest(
    "SHA-256",
    view.slice().buffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 把一次新读合并进既有记录:无 prev 则新建,有 prev 则保留 createdAt、刷新其余。 */
export function mergeEntry(
  prev: ReaderHistoryEntry | undefined,
  input: RecordInput,
): ReaderHistoryEntry {
  return {
    id: input.id,
    userId: input.userId,
    title: input.title,
    markdown: input.markdown,
    source: input.source,
    createdAt: prev?.createdAt ?? input.now,
    lastReadAt: input.now,
    sizeBytes: utf8Bytes(input.markdown),
  };
}

/** 超预算时返回应淘汰的 id(按 lastReadAt 从旧到新),始终保留最新一条。 */
export function selectEvictions(
  entries: ReaderHistoryEntry[],
  budget: number,
): string[] {
  const sorted = [...entries].sort((a, b) => a.lastReadAt - b.lastReadAt);
  let total = sorted.reduce((sum, e) => sum + e.sizeBytes, 0);
  const evict: string[] = [];
  let i = 0;
  while (total > budget && sorted.length - evict.length > 1) {
    const victim = sorted[i++];
    evict.push(victim.id);
    total -= victim.sizeBytes;
  }
  return evict;
}

/** 从 IDB 读出的原始值做结构校验,非法返回 null。 */
export function sanitizeEntry(raw: unknown): ReaderHistoryEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const src = r.source as Record<string, unknown> | undefined;
  if (
    typeof r.id !== "string" ||
    typeof r.userId !== "string" ||
    typeof r.title !== "string" ||
    typeof r.markdown !== "string" ||
    typeof r.createdAt !== "number" ||
    typeof r.lastReadAt !== "number" ||
    typeof r.sizeBytes !== "number" ||
    !src ||
    (src.kind !== "upload" && src.kind !== "url") ||
    typeof src.name !== "string"
  ) {
    return null;
  }
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    markdown: r.markdown,
    source: {
      kind: src.kind,
      name: src.name,
      url: typeof src.url === "string" ? src.url : undefined,
    },
    createdAt: r.createdAt,
    lastReadAt: r.lastReadAt,
    sizeBytes: r.sizeBytes,
  };
}
