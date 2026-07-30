import { describe, expect, it } from "vitest";
import { extractFirstJsonObject } from "#/lib/json-extract";

describe("extractFirstJsonObject", () => {
  it("parses clean JSON as-is", () => {
    const text = '{"a": 1, "b": "two"}';
    expect(extractFirstJsonObject(text)).toBe(text);
  });

  it("extracts JSON from a fenced ```json block", () => {
    const text = '```json\n{"a": 1}\n```';
    expect(extractFirstJsonObject(text)).toBe('{"a": 1}');
  });

  it("does not truncate on `}` inside a string value", () => {
    const text = '{"a": "text with } brace inside", "b": 2}';
    const result = extractFirstJsonObject(text);
    expect(result).toBe(text);
    expect(JSON.parse(result as string)).toEqual({
      a: "text with } brace inside",
      b: 2,
    });
  });

  it("extracts JSON preceded by prose", () => {
    const text = 'Sure, here is the result: {"a": 1}';
    expect(extractFirstJsonObject(text)).toBe('{"a": 1}');
  });

  it("returns null for unbalanced/truncated JSON", () => {
    const text = '{"a": 1, "b": [1, 2';
    expect(extractFirstJsonObject(text)).toBeNull();
  });

  it("returns null when there is no `{` at all", () => {
    expect(extractFirstJsonObject("no json here")).toBeNull();
  });
});
