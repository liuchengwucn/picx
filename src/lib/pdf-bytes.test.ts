import { describe, expect, it } from "vitest";
import { isPdfBuffer } from "./pdf-bytes";

describe("isPdfBuffer", () => {
  it("accepts a buffer starting with %PDF-", () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it("rejects non-PDF bytes", () => {
    expect(isPdfBuffer(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false); // ZIP
  });

  it("rejects a buffer shorter than the signature", () => {
    expect(isPdfBuffer(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});
