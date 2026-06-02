import { describe, expect, it } from "vitest";
import { percentEncode } from "./x-client";

describe("percentEncode (RFC 3986)", () => {
  it("encodes reserved chars but leaves unreserved intact", () => {
    expect(percentEncode("Ladies + Gentlemen")).toBe(
      "Ladies%20%2B%20Gentlemen",
    );
    expect(percentEncode("abcABC123-._~")).toBe("abcABC123-._~");
    expect(percentEncode("!*'()")).toBe("%21%2A%27%28%29");
  });
});
