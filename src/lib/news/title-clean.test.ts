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

  it("drops empty and date-only titles", () => {
    expect(cleanScrapedResearchTitle("")).toBeNull();
    expect(cleanScrapedResearchTitle("Jul 28, 2026")).toBeNull();
  });

  it("does not cut at camelCase brand names inside genuine titles", () => {
    // 尾部无句末标点 => 不是拼接的描述句，禁止在 "GitHub" 处切断
    expect(
      cleanScrapedResearchTitle(
        "Jul 8, 2026AlignmentClaude uses GitHub Actions to analyze economic data across many countries",
      ),
    ).toBe(
      "Claude uses GitHub Actions to analyze economic data across many countries",
    );
  });

  it("fully strips more than two stacked prefixes", () => {
    expect(
      cleanScrapedResearchTitle(
        "Societal ImpactsAlignmentJul 8, 2026Frontier Red TeamAn off switch for dual-use knowledge in AI models",
      ),
    ).toBe("An off switch for dual-use knowledge in AI models");
  });

  it("enforces the minimum description length at the junction", () => {
    const tail39 = "Now this glued description is here now.";
    const tail40 = "Now this glued description is here okay.";
    expect(tail39).toHaveLength(39);
    expect(tail40).toHaveLength(40);
    // 39 字符（差 1 达标）不切，40 字符恰好达标则切
    expect(cleanScrapedResearchTitle(`Jul 8, 2026Teaching why${tail39}`)).toBe(
      `Teaching why${tail39}`,
    );
    expect(cleanScrapedResearchTitle(`Jul 8, 2026Teaching why${tail40}`)).toBe(
      "Teaching why",
    );
  });

  it("cuts descriptions truncated with an ellipsis", () => {
    expect(
      cleanScrapedResearchTitle(
        "Jul 8, 2026AlignmentTeaching Claude whyNew research on how we reduced agentic misalignment in production…",
      ),
    ).toBe("Teaching Claude why");
  });
});
