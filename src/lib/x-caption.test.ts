import { describe, expect, it } from "vitest";
import { buildTweetCaption, summaryToTweetText } from "./x-caption";

describe("buildTweetCaption", () => {
  it("includes tldr and hashtags from categories", () => {
    const out = buildTweetCaption({
      tldr: "A transformer architecture based purely on attention.",
      categories: ["llm", "efficiency"],
    });
    expect(out).toContain("A transformer architecture");
    expect(out).toContain("#LLM");
    expect(out).toContain("#EfficientML");
    expect(out).not.toContain("picx.dev");
  });

  it("stays within 280 chars", () => {
    const out = buildTweetCaption({
      tldr: "x".repeat(500),
      categories: ["llm", "vision", "generative"],
    });
    expect([...out].length).toBeLessThanOrEqual(280);
  });

  it("skips 'other' category", () => {
    const out = buildTweetCaption({
      tldr: "Some paper.",
      categories: ["other", "llm"],
    });
    expect(out).not.toContain("#other");
    expect(out).toContain("#LLM");
  });

  it("caps at 3 hashtags", () => {
    const out = buildTweetCaption({
      tldr: "Paper.",
      categories: ["llm", "nlp", "vision", "generative"],
    });
    const hashtagCount = (out.match(/#\w+/g) ?? []).length;
    expect(hashtagCount).toBe(3);
  });

  it("handles empty categories", () => {
    const out = buildTweetCaption({
      tldr: "A paper with no categories.",
      categories: [],
    });
    expect(out).toBe("A paper with no categories.");
  });

  it("returns just hashtags when tldr is empty", () => {
    const out = buildTweetCaption({
      tldr: "",
      categories: ["retrieval-rag"],
    });
    expect(out).toBe("#RAG");
  });
});

describe("summaryToTweetText", () => {
  it("strips headings, emphasis and collapses to a single line", () => {
    const md = "## Key Idea\n\nWe propose a **fast** method that is _simple_.";
    expect(summaryToTweetText(md)).toBe(
      "Key Idea We propose a fast method that is simple.",
    );
  });

  it("keeps link text, drops urls and images", () => {
    const md = "See [the repo](https://example.com) ![fig](img.png) for code.";
    expect(summaryToTweetText(md)).toBe("See the repo for code.");
  });

  it("removes list markers, blockquotes, inline code and LaTeX markers", () => {
    const md = "> quote\n- item one\n- item two\nuse `npm` with $x^2$ math";
    expect(summaryToTweetText(md)).toBe(
      "quote item one item two use npm with x^2 math",
    );
  });

  it("drops fenced code blocks", () => {
    const md = "before\n```js\nconst a = 1;\n```\nafter";
    expect(summaryToTweetText(md)).toBe("before after");
  });

  it("produces a tweetable body when fed through buildTweetCaption", () => {
    const md = "# Title\n\nA **clear** contribution.";
    const out = buildTweetCaption({
      tldr: summaryToTweetText(md),
      categories: ["llm"],
    });
    expect(out).toContain("Title A clear contribution.");
    expect(out).toContain("#LLM");
    expect(out).not.toContain("**");
  });
});
