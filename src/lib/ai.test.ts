import { describe, expect, it } from "vitest";
import { parseClassification } from "./ai";

describe("parseClassification", () => {
  it("extracts valid categories and tags from clean JSON", () => {
    const out = parseClassification(
      '{"categories":["multimodal","vision"],"tags":["Image-Restoration","Diffusion"]}',
    );
    expect(out.categories).toEqual(["multimodal", "vision"]);
    expect(out.tags).toEqual(["image-restoration", "diffusion"]);
  });

  it("drops invalid category slugs, falls back to ['other'] if none valid", () => {
    const out = parseClassification('{"categories":["banana"],"tags":["x"]}');
    expect(out.categories).toEqual(["other"]);
  });

  it("caps categories at 3 and tags at 6", () => {
    const out = parseClassification(
      '{"categories":["llm","nlp","vision","agents"],"tags":["a","b","c","d","e","f","g"]}',
    );
    expect(out.categories).toHaveLength(3);
    expect(out.tags).toHaveLength(6);
  });

  it("tolerates surrounding prose / code fences", () => {
    const out = parseClassification(
      'Here you go:\n```json\n{"categories":["llm"],"tags":["rag"]}\n```',
    );
    expect(out.categories).toEqual(["llm"]);
    expect(out.tags).toEqual(["rag"]);
  });

  it("returns safe fallback on garbage", () => {
    const out = parseClassification("not json at all");
    expect(out).toEqual({ categories: ["other"], tags: [] });
  });
});
