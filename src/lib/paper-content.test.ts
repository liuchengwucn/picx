import { describe, expect, it } from "vitest";
import {
  buildPseudoPages,
  markdownImagePath,
  markdownToPlainText,
  paperContentImageKey,
  paperContentMarkdownKey,
  stripDangerousHtml,
} from "./paper-content";

describe("paperContentMarkdownKey / paperContentImageKey / markdownImagePath", () => {
  it("builds the expected R2 keys and markdown-relative path", () => {
    expect(paperContentMarkdownKey("abc123")).toBe(
      "paper-content/abc123/full.md",
    );
    expect(paperContentImageKey("abc123", "0-a.png")).toBe(
      "paper-content/abc123/images/0-a.png",
    );
    expect(markdownImagePath("0-a.png")).toBe("images/0-a.png");
  });
});

describe("stripDangerousHtml", () => {
  it("removes script blocks together with their contents", () => {
    const out = stripDangerousHtml(
      'before <script>alert("xss")</script> after',
    );

    expect(out).toBe("before  after");
    expect(out).not.toContain("alert");
  });

  it("removes script blocks regardless of case and attributes", () => {
    const out = stripDangerousHtml(
      '<SCRIPT type="text/javascript" src="//evil.example/x.js">steal()</Script>keep',
    );

    expect(out).toBe("keep");
  });

  it("removes multiline script blocks and multiple occurrences", () => {
    const out = stripDangerousHtml(
      "a<script>\nline1\nline2\n</script>b<script>x</script>c",
    );

    expect(out).toBe("abc");
  });

  it("removes an unterminated script tag so it cannot swallow the rest", () => {
    const out = stripDangerousHtml("body <script> trailing text");

    expect(out).not.toContain("<script");
    expect(out).toContain("trailing text");
  });

  it("removes iframe/object/embed/form tags but keeps the text between them", () => {
    const out = stripDangerousHtml(
      '<iframe src="//evil.example"></iframe>' +
        '<object data="x"></object>' +
        "<embed src='y'>" +
        '<form action="//evil.example"><input></form>' +
        "real content",
    );

    expect(out).not.toMatch(/<\/?(?:iframe|object|embed|form)\b/i);
    expect(out).toContain("real content");
    // form 内的其他标签不在黑名单里，仅标签本身被移除
    expect(out).toContain("<input>");
  });

  it("removes dangerous tags regardless of case and attributes", () => {
    const out = stripDangerousHtml('<IFRAME SRC="//evil.example" >x</IfRaMe>');

    expect(out).toBe("x");
  });

  it("removes tags that survive a single pass by re-joining their fragments", () => {
    // 单遍替换会把 `<scr` + `ipt>` 拼回 `<script>`：必须循环到不动点
    const out = stripDangerousHtml(
      "<scr<script>ipt>alert(1)</scr<script>ipt>keep",
    );

    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("keep");
  });

  it("removes nested split iframe fragments", () => {
    const out = stripDangerousHtml('<ifr<iframe>ame src="//evil.example">x');

    expect(out).not.toMatch(/<iframe/i);
    expect(out).toContain("x");
  });

  it("removes meta/base/link tags", () => {
    const out = stripDangerousHtml(
      '<meta http-equiv="refresh" content="0;url=//evil.example">' +
        '<base href="//evil.example/">' +
        '<link rel="stylesheet" href="//evil.example/x.css">' +
        "real content",
    );

    expect(out).not.toMatch(/<(?:meta|base|link)\b/i);
    expect(out).toBe("real content");
  });

  it("removes style blocks together with their CSS", () => {
    const out = stripDangerousHtml(
      "before<style>body{display:none}</style>after",
    );

    expect(out).toBe("beforeafter");
    expect(out).not.toContain("display:none");
  });

  it("keeps HTML tables and images untouched", () => {
    const table =
      "<table><tr><td>1</td><td>2</td></tr></table>\n\n" +
      '<img src="images/a.png" alt="fig 1" />';

    expect(stripDangerousHtml(table)).toBe(table);
  });

  it("leaves plain markdown untouched", () => {
    const markdown = "# Title\n\n| a | b |\n| --- | --- |\n\n$E = mc^2$";

    expect(stripDangerousHtml(markdown)).toBe(markdown);
  });
});

describe("markdownToPlainText", () => {
  it("strips markdown image references", () => {
    const out = markdownToPlainText("before ![fig](images/a.png) after");

    expect(out).not.toContain("images/a.png");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("strips inline <img> tags", () => {
    const out = markdownToPlainText(
      'before <img src="images/a.png" alt="x" /> after',
    );

    expect(out).not.toContain("<img");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("removes the leading # from heading lines", () => {
    const out = markdownToPlainText("# Title\n\n## References\n\nbody");

    expect(out).toContain("Title");
    expect(out).toContain("References");
    expect(out).not.toMatch(/^#/m);
  });

  it("keeps tables (pipe and HTML) as-is", () => {
    const pipeTable = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(markdownToPlainText(pipeTable)).toBe(pipeTable);

    const htmlTable = "<table><tr><td>1</td></tr></table>";
    expect(markdownToPlainText(htmlTable)).toBe(htmlTable);
  });

  it("collapses 3+ consecutive blank lines down to one blank line", () => {
    const out = markdownToPlainText("a\n\n\n\n\nb");

    expect(out).toBe("a\n\nb");
  });

  it("trims leading/trailing whitespace", () => {
    expect(markdownToPlainText("\n\n  hello  \n\n")).toBe("hello");
  });
});

describe("buildPseudoPages", () => {
  function assertOffsetsMatch(
    text: string,
    pages: ReturnType<typeof buildPseudoPages>,
  ) {
    for (const page of pages) {
      const slice = text.slice(
        page.startOffset,
        page.startOffset + page.text.length,
      );
      expect(slice).toBe(page.text);
    }
  }

  it("returns an empty array for an empty string", () => {
    expect(buildPseudoPages("")).toEqual([]);
  });

  it("returns a single page for short text", () => {
    const text = "line1\nline2\nline3";
    const pages = buildPseudoPages(text);

    expect(pages).toHaveLength(1);
    expect(pages[0].pageNumber).toBe(1);
    expect(pages[0].startOffset).toBe(0);
    expect(pages[0].text).toBe(text);
    assertOffsetsMatch(text, pages);
  });

  it("splits long text into multiple pages at chunk boundaries", () => {
    const lines = Array.from(
      { length: 50 },
      (_, i) => `line ${i} ${"x".repeat(50)}`,
    );
    const text = lines.join("\n");
    const pages = buildPseudoPages(text, 500);

    expect(pages.length).toBeGreaterThan(1);
    assertOffsetsMatch(text, pages);
  });

  it("assigns page numbers continuously starting at 1", () => {
    const lines = Array.from(
      { length: 30 },
      (_, i) => `line ${i} ${"x".repeat(40)}`,
    );
    const text = lines.join("\n");
    const pages = buildPseudoPages(text, 300);

    expect(pages.map((p) => p.pageNumber)).toEqual(pages.map((_, i) => i + 1));
  });

  it("satisfies the startOffset/text slice invariant even when the text has no trailing newline", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `paragraph number ${i}`);
    const text = lines.join("\n"); // no trailing newline
    expect(text.endsWith("\n")).toBe(false);

    const pages = buildPseudoPages(text, 80);

    expect(pages.length).toBeGreaterThan(1);
    assertOffsetsMatch(text, pages);
    // 最后一页应恰好到达文本末尾。
    const last = pages[pages.length - 1];
    expect(last.startOffset + last.text.length).toBe(text.length);
  });

  it("satisfies the startOffset/text slice invariant when the text ends with a trailing newline", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `paragraph number ${i}`);
    const text = `${lines.join("\n")}\n`;

    const pages = buildPseudoPages(text, 80);

    assertOffsetsMatch(text, pages);
  });

  it("reconstructs the full text by concatenating pages with newlines", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `row-${i}`);
    const text = lines.join("\n");
    const pages = buildPseudoPages(text, 20);

    expect(pages.map((p) => p.text).join("\n")).toBe(text);
  });
});
