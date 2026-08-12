import { describe, expect, it } from "vitest";
import { StreamBuffer } from "#/lib/stream-buffer";

// @cloudflare/workers-types 重定义的全局 ReadableStream 没有 Symbol.asyncIterator，
// for-await 会挂 tsc；改用 getReader()，同 chat-stream.test.ts 的 collect() 写法。
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe("StreamBuffer", () => {
  it("replays buffered lines to a late subscriber and then closes when ended", async () => {
    const buffer = new StreamBuffer();
    buffer.append("data: a\n\n");
    buffer.append("data: b\n\n");
    const stream = buffer.subscribe();
    buffer.append("data: c\n\n");
    buffer.end();
    expect(await readAll(stream)).toBe("data: a\n\ndata: b\n\ndata: c\n\n");
  });

  it("subscribe after end replays everything and closes immediately", async () => {
    const buffer = new StreamBuffer();
    buffer.append("data: a\n\n");
    buffer.end();
    expect(buffer.done).toBe(true);
    expect(await readAll(buffer.subscribe())).toBe("data: a\n\n");
  });

  it("a cancelled subscriber does not break later appends or other subscribers", async () => {
    const buffer = new StreamBuffer();
    const dead = buffer.subscribe();
    await dead.cancel();
    const live = buffer.subscribe();
    buffer.append("data: x\n\n");
    buffer.end();
    expect(await readAll(live)).toBe("data: x\n\n");
  });

  it("append after end is a no-op", async () => {
    const buffer = new StreamBuffer();
    buffer.end();
    buffer.append("data: late\n\n");
    expect(await readAll(buffer.subscribe())).toBe("");
  });
});
