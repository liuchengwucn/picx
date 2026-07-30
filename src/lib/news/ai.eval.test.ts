import { describe, expect, it } from "vitest";
import { judgeAssignment } from "./ai";

// 手动评估脚本（golden cases）：不进 CI，无 key 时自动 skip。
// 运行：OPENAI_API_KEY=sk-... OPENAI_MODEL=... mac npx vitest run src/lib/news/ai.eval.test.ts
const apiKey = process.env.OPENAI_API_KEY;
const config = {
  openaiApiKey: apiKey ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiModel: process.env.OPENAI_MODEL,
  geminiApiKey: "",
};

const CANDIDATES = [
  {
    title: "DeepSeek releases DeepSeek-V4 with 1M context",
    summary:
      "DeepSeek launched V4, a new MoE flagship model with a 1M-token context window.",
  },
  {
    title: "Anthropic publishes interpretability paper on feature circuits",
    summary: "New research tracing circuits in production LLMs.",
  },
];

describe.skipIf(!apiKey)("judgeAssignment golden cases", () => {
  it("merges same-event coverage from another source", async () => {
    const idx = await judgeAssignment(
      {
        title: "DeepSeek V4 tops open-model leaderboards on day one",
        excerpt:
          "The newly released DeepSeek-V4 already leads several benchmarks.",
      },
      CANDIDATES,
      config,
    );
    expect(idx).toBe(0);
  }, 30_000);
  it("does not merge a different model's news", async () => {
    const idx = await judgeAssignment(
      {
        title: "Qwen 4 announced with new attention variant",
        excerpt: "Alibaba's Qwen team announced Qwen 4.",
      },
      CANDIDATES,
      config,
    );
    expect(idx).toBeNull();
  }, 30_000);
  it("does not merge criticism of an unrelated event", async () => {
    const idx = await judgeAssignment(
      {
        title: "Why 1M context windows are mostly marketing",
        excerpt: "An essay arguing long-context claims rarely hold up.",
      },
      CANDIDATES,
      config,
    );
    expect(idx).toBeNull();
  }, 30_000);
});
