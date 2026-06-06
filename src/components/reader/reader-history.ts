import { useCallback, useEffect, useState } from "react";

export type ReaderHistorySource =
  | { kind: "upload"; name: string }
  | { kind: "url"; name: string; url: string };

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

/** 字节的 SHA-256,返回 64 字符小写十六进制。 */
export async function hashBytes(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  const view =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  // digest 直接读视图(尊重 byteOffset/length),零拷贝。TS 5.7 把 TypedArray 泛
  // 型化为 Uint8Array<ArrayBufferLike>,与 DOM 的 BufferSource 不匹配,故断言。
  const digest = await crypto.subtle.digest("SHA-256", view as BufferSource);
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
  let source: ReaderHistorySource;
  if (src.kind === "upload") {
    source = { kind: "upload", name: src.name };
  } else {
    if (typeof src.url !== "string") {
      return null;
    }
    source = { kind: "url", name: src.name, url: src.url };
  }
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    markdown: r.markdown,
    source,
    createdAt: r.createdAt,
    lastReadAt: r.lastReadAt,
    sizeBytes: r.sizeBytes,
  };
}

const DB_NAME = "picx-reader";
const STORE = "history";
const USER_INDEX = "by-user";

function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(USER_INDEX, "userId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getEntry(
  id: string,
): Promise<ReaderHistoryEntry | undefined> {
  if (!isAvailable()) {
    return undefined;
  }
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    const raw = await new Promise<unknown>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return sanitizeEntry(raw) ?? undefined;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

export async function listEntries(
  userId: string,
): Promise<ReaderHistoryEntry[]> {
  if (!isAvailable() || !userId) {
    return [];
  }
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).index(USER_INDEX).getAll(userId);
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    return rows
      .map(sanitizeEntry)
      .filter((e): e is ReaderHistoryEntry => e !== null)
      .sort((a, b) => b.lastReadAt - a.lastReadAt);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function putEntry(entry: ReaderHistoryEntry): Promise<void> {
  if (!isAvailable()) {
    return;
  }
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    await txDone(tx);
  } catch {
    // 配额超限等:静默,交由 recordRead 的淘汰兜底。
  } finally {
    db?.close();
  }
}

export async function deleteEntry(id: string): Promise<void> {
  if (!isAvailable()) {
    return;
  }
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } catch {
    // 忽略
  } finally {
    db?.close();
  }
}

/** 读-改-写一次新阅读:合并 → 落库 → 按预算淘汰。失败静默降级。 */
export async function recordRead(
  input: RecordInput,
  budget: number = HISTORY_BUDGET_BYTES,
): Promise<void> {
  if (!isAvailable() || !input.userId) {
    return;
  }
  const prev = await getEntry(input.id);
  const entry = mergeEntry(prev, input);
  await putEntry(entry);
  const all = await listEntries(input.userId);
  for (const id of selectEvictions(all, budget)) {
    await deleteEntry(id);
  }
}

/**
 * 读取/记录/删除当前账号的阅读历史。重开逻辑不在此(需 page 的 setDoc/setPhase),
 * 由 ReaderPage 拿 entry 自行处理。水合策略同 useReaderSettings:首帧空,挂载后注入。
 */
export function useReaderHistory(userId: string | null) {
  const [entries, setEntries] = useState<ReaderHistoryEntry[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setEntries([]);
      return;
    }
    setEntries(await listEntries(userId));
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const record = useCallback(
    async (input: RecordInput) => {
      await recordRead(input);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteEntry(id);
      await refresh();
    },
    [refresh],
  );

  return { entries, record, remove };
}
