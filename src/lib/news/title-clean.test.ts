import { describe, expect, it } from "vitest";
import { cleanScrapedResearchTitle } from "./title-clean";

describe("cleanScrapedResearchTitle", () => {
  it("strips a leading date + category prefix", () => {
    expect(
      cleanScrapedResearchTitle(
        "Jul 28, 2026Frontier Red TeamDiscovering cryptographic weaknesses with Claude",
      ),
    ).toBe("Discovering cryptographic weaknesses with Claude");
    expect(
      cleanScrapedResearchTitle(
        "Jul 24, 2026Frontier Red TeamProject Pilot: Can AI control a drone?",
      ),
    ).toBe("Project Pilot: Can AI control a drone?");
    expect(
      cleanScrapedResearchTitle(
        "Jul 14, 2026Economic ResearchHow Canada uses Claude: Findings from the Anthropic Economic Index",
      ),
    ).toBe(
      "How Canada uses Claude: Findings from the Anthropic Economic Index",
    );
    expect(
      cleanScrapedResearchTitle(
        "Jul 13, 2026Societal ImpactsClaude’s values across models and languages",
      ),
    ).toBe("Claude’s values across models and languages");
    expect(
      cleanScrapedResearchTitle(
        "Jul 8, 2026AlignmentAn off switch for dual-use knowledge in AI models",
      ),
    ).toBe("An off switch for dual-use knowledge in AI models");
  });

  it("handles category-before-date ordering and cuts trailing description text", () => {
    expect(
      cleanScrapedResearchTitle(
        "Economic ResearchJun 26, 2026Anthropic Economic Index report: CadencesIn our latest Economic Index report, we sample hourly for the first time to ask: When do people come to Claude?",
      ),
    ).toBe("Anthropic Economic Index report: Cadences");
    expect(
      cleanScrapedResearchTitle(
        "AlignmentMay 8, 2026Teaching Claude whyNew research on how we've reduced agentic misalignment.",
      ),
    ).toBe("Teaching Claude why");
  });

  it("keeps already-clean titles unchanged", () => {
    expect(
      cleanScrapedResearchTitle("A global workspace in language models"),
    ).toBe("A global workspace in language models");
  });

  it("does not strip a category followed by a space (legit title start)", () => {
    expect(cleanScrapedResearchTitle("Alignment faking in LLMs")).toBe(
      "Alignment faking in LLMs",
    );
  });

  it("drops bare category-only navigation junk", () => {
    expect(cleanScrapedResearchTitle("Economic Research")).toBeNull();
    expect(cleanScrapedResearchTitle("Societal Impacts")).toBeNull();
    expect(cleanScrapedResearchTitle("Alignment")).toBeNull();
    expect(cleanScrapedResearchTitle("Frontier Red Team")).toBeNull();
    expect(cleanScrapedResearchTitle("Interpretability")).toBeNull();
  });
});
