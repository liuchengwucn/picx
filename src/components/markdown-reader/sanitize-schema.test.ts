import type { Element, Root } from "hast";
import rehypeSanitize from "rehype-sanitize";
import { describe, expect, it } from "vitest";
import { SANITIZE_SCHEMA } from "./markdown-article";

/**
 * 渲染端白名单（rehype-sanitize）的行为固定。这层是原文视图 XSS 的实际安全边界：
 * 落盘前的 stripDangerousHtml 是黑名单第一层，绕过了还有这里兜底。
 *
 * 直接在 hast 上跑插件的 transformer —— 不引 parser，测的就是 schema 本身。
 */
function sanitize(children: Root["children"]): Root {
  const tree: Root = { type: "root", children };
  // rehype-sanitize 的 transformer 就地改写并返回新树
  const transform = rehypeSanitize(SANITIZE_SCHEMA) as (root: Root) => Root;
  return transform(tree);
}

function el(
  tagName: string,
  properties: Element["properties"] = {},
  children: Element["children"] = [],
): Element {
  return { type: "element", tagName, properties, children };
}

function text(value: string) {
  return { type: "text" as const, value };
}

function firstElement(root: Root): Element | undefined {
  return root.children.find((child) => child.type === "element") as
    | Element
    | undefined;
}

describe("SANITIZE_SCHEMA", () => {
  it("keeps inline base64 images (/reader 把图片内联成 data: URL)", () => {
    const out = sanitize([
      el("img", {
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        alt: "inline",
      }),
    ]);

    const img = firstElement(out);
    expect(img?.tagName).toBe("img");
    expect(String(img?.properties.src)).toMatch(/^data:image\/png;base64,/);
    expect(img?.properties.alt).toBe("inline");
  });

  it("keeps relative and https image sources", () => {
    const out = sanitize([
      el("img", { src: "images/a.png" }),
      el("img", { src: "https://example.com/a.png" }),
    ]);

    const sources = out.children
      .filter((child): child is Element => child.type === "element")
      .map((child) => child.properties.src);
    expect(sources).toEqual(["images/a.png", "https://example.com/a.png"]);
  });

  it("drops javascript: links and inline event handlers", () => {
    const out = sanitize([
      el("a", { href: "javascript:alert(1)" }, [text("link")]),
      el("img", { src: "x", onError: "alert(1)" }),
    ]);

    const [anchor, img] = out.children.filter(
      (child): child is Element => child.type === "element",
    );
    expect(anchor.properties.href).toBeUndefined();
    expect(img.properties.onError).toBeUndefined();
  });

  it("drops script and style together with their contents", () => {
    const out = sanitize([
      el("script", {}, [text("alert(1)")]),
      el("style", {}, [text("body{display:none}")]),
      text("kept"),
    ]);

    expect(out.children).toHaveLength(1);
    expect(out.children[0]).toMatchObject({ type: "text", value: "kept" });
  });

  it("drops iframe/meta/base but keeps their text children", () => {
    const out = sanitize([
      el("iframe", { src: "//evil.example" }, [text("frame text")]),
      el("meta", { httpEquiv: "refresh", content: "0;url=//evil.example" }),
      el("base", { href: "//evil.example/" }),
    ]);

    expect(
      out.children.filter((child) => child.type === "element"),
    ).toHaveLength(0);
    // 标签被拆掉，正文（论文里可能是真内容）保留
    expect(JSON.stringify(out)).toContain("frame text");
  });

  it("keeps the math class names remark-math emits (katex 靠它识别公式)", () => {
    const out = sanitize([
      el("code", { className: ["language-math", "math-inline"] }, [
        text("E = mc^2"),
      ]),
      el("span", { className: ["math", "math-display"] }),
      el("div", { className: ["math", "math-display"] }),
    ]);

    const [code, span, div] = out.children.filter(
      (child): child is Element => child.type === "element",
    );
    expect(code.properties.className).toEqual(["language-math", "math-inline"]);
    expect(span.properties.className).toEqual(["math", "math-display"]);
    expect(div.properties.className).toEqual(["math", "math-display"]);
  });

  it("keeps language-* on code (highlight.js) but drops arbitrary classes", () => {
    const out = sanitize([
      el("code", { className: ["language-python", "fixed-overlay"] }),
      el("span", { className: ["site-banner"] }),
    ]);

    const [code, span] = out.children.filter(
      (child): child is Element => child.type === "element",
    );
    expect(code.properties.className).toEqual(["language-python"]);
    expect(span.properties.className).toEqual([]);
  });

  it("keeps table structure and cell layout attributes", () => {
    const out = sanitize([
      el("table", {}, [
        el("tbody", {}, [
          el("tr", {}, [
            el("td", { colSpan: 2, rowSpan: 2, align: "right" }, [text("1")]),
            el("th", { scope: "col" }, [text("h")]),
          ]),
        ]),
      ]),
    ]);

    const table = firstElement(out);
    expect(table?.tagName).toBe("table");
    const td = (
      (table?.children[0] as Element).children[0] as Element
    ).children.find(
      (child): child is Element =>
        child.type === "element" && child.tagName === "td",
    );
    expect(td?.properties).toMatchObject({
      colSpan: 2,
      rowSpan: 2,
      align: "right",
    });
  });
});
