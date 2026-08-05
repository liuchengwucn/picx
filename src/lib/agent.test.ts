import { describe, expect, it } from "vitest";
import { escapeLike, markInLibrary, parseArxivAtom } from "#/lib/agent";

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2601.13209v2</id>
    <title>Test Paper:
      Multi-line Title</title>
    <summary>An abstract with &amp;amp; escaped &amp;lt;chars&amp;gt;.</summary>
    <published>2026-01-20T18:00:00Z</published>
    <author><name>Alice A</name></author>
    <author><name>Bob B</name></author>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v1</id>
    <title>Legacy Id Paper</title>
    <summary>Old format.</summary>
    <published>1999-01-04T00:00:00Z</published>
    <author><name>Carol C</name></author>
  </entry>
</feed>`;

describe("parseArxivAtom", () => {
  it("extracts entries with canonical ids, authors, categories", () => {
    const entries = parseArxivAtom(SAMPLE_ATOM);
    expect(entries).toHaveLength(2);
    expect(entries[0].arxivId).toBe("2601.13209");
    expect(entries[0].url).toBe("https://arxiv.org/abs/2601.13209");
    expect(entries[0].title).toBe("Test Paper: Multi-line Title");
    expect(entries[0].authors).toEqual(["Alice A", "Bob B"]);
    expect(entries[0].categories).toEqual(["cs.CL"]);
    expect(entries[0].published).toBe("2026-01-20");
    expect(entries[1].arxivId).toBe("hep-th/9901001");
  });

  it("returns empty array for garbage input", () => {
    expect(parseArxivAtom("not xml at all")).toEqual([]);
  });
});

describe("escapeLike", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});

describe("markInLibrary", () => {
  it("marks entries whose canonical url is owned", () => {
    const entries = parseArxivAtom(SAMPLE_ATOM);
    const owned = new Map([["https://arxiv.org/abs/2601.13209", "abc123"]]);
    const marked = markInLibrary(entries, owned);
    expect(marked[0]).toMatchObject({
      inLibrary: true,
      libraryShortId: "abc123",
    });
    expect(marked[1]).toMatchObject({ inLibrary: false });
    expect(marked[1].libraryShortId).toBeUndefined();
  });
});
