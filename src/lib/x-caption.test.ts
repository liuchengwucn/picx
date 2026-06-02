import { describe, expect, it } from "vitest";
import { buildTweetCaption } from "./x-caption";

describe("buildTweetCaption", () => {
  it("includes the tldr and the paper link", () => {
    const out = buildTweetCaption({
      tldr: "A transformer architecture based purely on attention.",
      shortId: "abc123",
    });
    expect(out).toContain("A transformer architecture");
    expect(out).toContain("https://picx.dev/p/abc123");
  });

  it("stays within 280 chars counting the link as 23", () => {
    const out = buildTweetCaption({
      tldr: "x".repeat(500),
      shortId: "abc123",
    });
    // 把 URL 还原成 23 计长
    const url = "https://picx.dev/p/abc123";
    const weighted = out.replace(url, "x".repeat(23));
    expect([...weighted].length).toBeLessThanOrEqual(280);
  });

  it("returns just the link when tldr is empty", () => {
    const out = buildTweetCaption({ tldr: "", shortId: "abc123" });
    expect(out).toContain("https://picx.dev/p/abc123");
  });
});
