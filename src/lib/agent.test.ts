import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildAgentTools } from "#/lib/agent";

type AgentDeps = Parameters<typeof buildAgentTools>[0];

describe("buildAgentSystemPrompt", () => {
  const WEB_SEARCH_LINE =
    "- Only call web search when the question needs information beyond the tools above (blogs, conference pages, current events). Judge relevance before citing.";

  it("web search enabled, no profile: includes web search line, no profile block", () => {
    const prompt = buildAgentSystemPrompt(null, true, "");
    expect(prompt).toContain(WEB_SEARCH_LINE);
    expect(prompt).not.toContain("<user_profile>");
  });

  it("web search disabled, no profile: omits web search line, no profile block", () => {
    const prompt = buildAgentSystemPrompt(null, false, "");
    expect(prompt).not.toContain(WEB_SEARCH_LINE);
    expect(prompt).not.toContain("<user_profile>");
  });

  it("web search enabled, with profile: includes both web search line and profile block", () => {
    const prompt = buildAgentSystemPrompt(
      "Interested in diffusion models.",
      true,
      "",
    );
    expect(prompt).toContain(WEB_SEARCH_LINE);
    expect(prompt).toContain("<user_profile>");
    expect(prompt).toContain("Interested in diffusion models.");
    expect(prompt).toContain("</user_profile>");
  });

  it("web search disabled, with profile: omits web search line, includes profile block", () => {
    const prompt = buildAgentSystemPrompt(
      "Interested in diffusion models.",
      false,
      "",
    );
    expect(prompt).not.toContain(WEB_SEARCH_LINE);
    expect(prompt).toContain("<user_profile>");
    expect(prompt).toContain("Interested in diffusion models.");
  });
});

describe("buildAgentTools", () => {
  // 同 chat.test.ts：类型系统看不见「少了一个 spread」，漏掉 buildDiscoveryTools
  // 照样编译通过、照样上线，只是助手页悄悄没了发现能力。这条断言把接线钉住。
  it("exposes the library/news/profile tools plus the shared discovery trio", () => {
    const tools = buildAgentTools({
      db: {} as unknown as AgentDeps["db"],
      bucket: {} as unknown as AgentDeps["bucket"],
      userId: "user-1",
      locale: "en",
      isGuest: false,
    });

    expect(Object.keys(tools).sort()).toEqual([
      "listDailyPapers",
      "listMyPapers",
      "readPaper",
      "readSkill",
      "recommendPapers",
      "searchArxiv",
      "searchMyPapers",
      "searchNews",
      "updateProfile",
    ]);
  });
});
