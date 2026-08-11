import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "#/lib/agent";

describe("buildAgentSystemPrompt", () => {
  const WEB_SEARCH_LINE =
    "- Only call web search when the question needs information beyond the tools above (blogs, conference pages, current events). Judge relevance before citing.";

  it("web search enabled, no profile: includes web search line, no profile block", () => {
    const prompt = buildAgentSystemPrompt(null, true);
    expect(prompt).toContain(WEB_SEARCH_LINE);
    expect(prompt).not.toContain("<user_profile>");
  });

  it("web search disabled, no profile: omits web search line, no profile block", () => {
    const prompt = buildAgentSystemPrompt(null, false);
    expect(prompt).not.toContain(WEB_SEARCH_LINE);
    expect(prompt).not.toContain("<user_profile>");
  });

  it("web search enabled, with profile: includes both web search line and profile block", () => {
    const prompt = buildAgentSystemPrompt(
      "Interested in diffusion models.",
      true,
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
    );
    expect(prompt).not.toContain(WEB_SEARCH_LINE);
    expect(prompt).toContain("<user_profile>");
    expect(prompt).toContain("Interested in diffusion models.");
  });
});
