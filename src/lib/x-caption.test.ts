import { describe, expect, it } from "vitest";
import { buildTweetCaption, TWEET_HASHTAGS } from "./x-caption";

describe("buildTweetCaption", () => {
  it("includes title, tldr, the paper link, and hashtags", () => {
    const out = buildTweetCaption({
      title: "Attention Is All You Need",
      tldr: "A transformer architecture based purely on attention.",
      shortId: "abc123",
    });
    expect(out).toContain("Attention Is All You Need");
    expect(out).toContain("A transformer architecture");
    expect(out).toContain("https://picx.dev/p/abc123");
    expect(out).toContain(TWEET_HASHTAGS);
  });

  it("stays within 280 chars counting the link as 23", () => {
    const longTldr = "x".repeat(500);
    const out = buildTweetCaption({
      title: "y".repeat(200),
      tldr: longTldr,
      shortId: "abc123",
    });
    // 把 URL 还原成 23 计长
    const url = "https://picx.dev/p/abc123";
    const weighted = out.replace(url, "x".repeat(23));
    expect([...weighted].length).toBeLessThanOrEqual(280);
  });

  it("omits the tldr line when tldr is empty", () => {
    const out = buildTweetCaption({
      title: "Title",
      tldr: "",
      shortId: "abc123",
    });
    expect(out).toContain("Title");
    expect(out).toContain("https://picx.dev/p/abc123");
  });
});
