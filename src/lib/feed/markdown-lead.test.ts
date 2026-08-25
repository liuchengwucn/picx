import { describe, expect, it } from "vitest";
import { markdownLeadHtml } from "./markdown-lead";

describe("markdownLeadHtml", () => {
  it("跳过标题行且标题不占块数", () => {
    const md = "# 本期看点\n\n第一段\n\n第二段\n\n第三段\n\n第四段";
    expect(markdownLeadHtml(md, 3)).toBe(
      "<p>第一段</p><p>第二段</p><p>第三段</p>",
    );
  });

  it("整个列表算一块", () => {
    const md = "导语\n\n- 甲\n- 乙\n- 丙\n\n收尾";
    expect(markdownLeadHtml(md, 2)).toBe(
      "<p>导语</p><ul><li>甲</li><li>乙</li><li>丙</li></ul>",
    );
  });

  it("有序列表用 ol", () => {
    expect(markdownLeadHtml("1. 甲\n2. 乙", 1)).toBe(
      "<ol><li>甲</li><li>乙</li></ol>",
    );
  });

  it("支持链接、加粗、行内代码", () => {
    const md = "见 [论文](https://arxiv.org/abs/1) 与 **要点** 和 `code`";
    expect(markdownLeadHtml(md, 1)).toBe(
      '<p>见 <a href="https://arxiv.org/abs/1">论文</a> 与 <strong>要点</strong> 和 <code>code</code></p>',
    );
  });

  it("挡掉非 http/相对协议的链接，保留原文", () => {
    const out = markdownLeadHtml("点[这里](javascript:alert(1))", 1);
    expect(out).not.toContain("<a");
    expect(out).toContain("javascript:alert(1)");
  });

  it("转义先于标记还原，正文里的标签不会活过来", () => {
    expect(markdownLeadHtml("<script>alert(1)</script>", 1)).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });

  it("LaTeX 与表格降级为纯文本", () => {
    expect(markdownLeadHtml("误差是 $O(n^2)$", 1)).toBe(
      "<p>误差是 $O(n^2)$</p>",
    );
    expect(markdownLeadHtml("| a | b |", 1)).toBe("<p>| a | b |</p>");
  });

  it("空输入返回空串", () => {
    expect(markdownLeadHtml(null)).toBe("");
    expect(markdownLeadHtml("")).toBe("");
    expect(markdownLeadHtml("# 只有标题")).toBe("");
  });
});
