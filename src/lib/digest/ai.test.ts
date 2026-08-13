import { describe, expect, it } from "vitest";
import { pastPicksBlock } from "./ai";

describe("pastPicksBlock", () => {
  it("renders a placeholder for an empty list (unconditional injection contract)", () => {
    expect(pastPicksBlock([])).toBe("(no prior picks yet)");
  });

  it("renders one line per pick with issue number, collapsing whitespace, omitting empty notes", () => {
    const out = pastPicksBlock([
      {
        issueNumber: 12,
        title: "  Multi\n line\ttitle ",
        note: "why  read\nit",
      },
      { issueNumber: 11, title: "Plain", note: "" },
    ]);
    expect(out).toBe("- [#12] Multi line title — why read it\n- [#11] Plain");
  });
});
