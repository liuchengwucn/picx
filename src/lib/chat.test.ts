import { describe, expect, it } from "vitest";
import {
  buildChatTools,
  CHAT_LIMITS,
  mapReasoningEffort,
  sliceSection,
} from "./chat";

const SECTION_SIZE = CHAT_LIMITS.sectionChars;

/** minimal ToolExecutionOptions stub — only fields required by the type */
const toolOptions = { toolCallId: "test-call", messages: [] } as never;

/** readPaper.execute is optional per the Tool type; assert it's set without a `!` (biome forbids it) */
function readPaper(
  tools: ReturnType<typeof buildChatTools>,
  input: { section: number },
) {
  const { execute } = tools.readPaper;
  if (!execute) throw new Error("readPaper.execute is not defined");
  return execute(input, toolOptions);
}

describe("sliceSection", () => {
  it("splits long text into sections and returns the requested one", () => {
    const text = "a".repeat(2 * SECTION_SIZE + 100);

    const first = sliceSection(text, 1);
    expect(first.sectionCount).toBe(3);
    expect(first.section).toBe(1);
    expect(first.text).toHaveLength(SECTION_SIZE);
    expect(first.error).toBeUndefined();

    const last = sliceSection(text, 3);
    expect(last.sectionCount).toBe(3);
    expect(last.section).toBe(3);
    expect(last.text).toHaveLength(100);
  });

  it("does not produce a ghost final section when text length divides evenly", () => {
    const text = "b".repeat(2 * SECTION_SIZE);
    const result = sliceSection(text, 1);
    expect(result.sectionCount).toBe(2);
  });

  it("returns an error when section is out of range", () => {
    const result = sliceSection("short text", 99);
    expect(result.sectionCount).toBe(1);
    expect(result.error).toBe("section out of range");
    expect(result.text).toBeUndefined();
  });

  it("clamps section 0 or negative to section 1", () => {
    const text = "c".repeat(10);
    expect(sliceSection(text, 0)).toEqual({
      section: 1,
      sectionCount: 1,
      text,
    });
    expect(sliceSection(text, -5)).toEqual({
      section: 1,
      sectionCount: 1,
      text,
    });
  });

  it("handles empty string as a single empty section", () => {
    const result = sliceSection("", 1);
    expect(result.sectionCount).toBe(1);
    expect(result.section).toBe(1);
    expect(result.text).toBe("");
  });
});

describe("mapReasoningEffort", () => {
  it("maps off to an explicit enabled:false (some models default reasoning on)", () => {
    expect(mapReasoningEffort("off")).toEqual({ enabled: false });
  });

  it("maps low/medium/high to an effort object", () => {
    expect(mapReasoningEffort("low")).toEqual({ effort: "low" });
    expect(mapReasoningEffort("medium")).toEqual({ effort: "medium" });
    expect(mapReasoningEffort("high")).toEqual({ effort: "high" });
  });

  it("never mixes enabled and effort in one object", () => {
    expect(mapReasoningEffort("high")).not.toHaveProperty("enabled");
    expect(mapReasoningEffort("off")).not.toHaveProperty("effort");
  });
});

describe("buildChatTools readPaper", () => {
  it("returns an error object when the R2 object is missing", async () => {
    const bucket = { get: async () => null } as unknown as R2Bucket;
    const tools = buildChatTools(bucket, "paper-1");

    const result = await readPaper(tools, { section: 1 });

    expect(result).toMatchObject({ error: expect.any(String) });
    expect((result as { text?: string }).text).toBeUndefined();
  });

  it("memoizes the R2 GET across multiple execute calls", async () => {
    let getCalls = 0;
    const fullText = "z".repeat(SECTION_SIZE + 10);
    const bucket = {
      get: async () => {
        getCalls++;
        return { text: async () => fullText };
      },
    } as unknown as R2Bucket;
    const tools = buildChatTools(bucket, "paper-1");

    const r1 = await readPaper(tools, { section: 1 });
    const r2 = await readPaper(tools, { section: 2 });

    expect(getCalls).toBe(1);
    expect(r1).toMatchObject({ section: 1, sectionCount: 2 });
    expect(r2).toMatchObject({ section: 2, sectionCount: 2 });
  });

  it("returns section/sectionCount/text on the normal path", async () => {
    const fullText = "paper contents";
    const bucket = {
      get: async () => ({ text: async () => fullText }),
    } as unknown as R2Bucket;
    const tools = buildChatTools(bucket, "paper-1");

    const result = await readPaper(tools, { section: 1 });

    expect(result).toEqual({
      section: 1,
      sectionCount: 1,
      text: fullText,
    });
  });
});
