import { describe, expect, it } from "vitest";
import { rehypeTableMath } from "./rehype-plugins";

// biome-ignore lint/suspicious/noExplicitAny: 测试里手搓极简 hast 节点
type Node = any;

function text(value: string): Node {
  return { type: "text", value };
}
function el(tagName: string, children: Node[], properties?: Node): Node {
  return { type: "element", tagName, properties: properties ?? {}, children };
}
function td(...children: Node[]): Node {
  return el("td", children);
}
function table(...cells: Node[]): Node {
  return el("table", [el("tbody", [el("tr", cells)])]);
}

function run(tree: Node): Node {
  rehypeTableMath()(tree);
  return tree;
}

/** 取某子树下第一个 math span(包含其 latex 文本)。 */
function findMath(node: Node): { display: boolean; latex: string } | null {
  if (node.type === "element" && Array.isArray(node.properties?.className)) {
    const cls: string[] = node.properties.className;
    if (cls.includes("math-inline") || cls.includes("math-display")) {
      return {
        display: cls.includes("math-display"),
        latex: node.children?.[0]?.value ?? "",
      };
    }
  }
  for (const child of node.children ?? []) {
    const hit = findMath(child);
    if (hit) {
      return hit;
    }
  }
  return null;
}

describe("rehypeTableMath", () => {
  it("把表格单元格里的 $...$ 转成 math-inline span", () => {
    const tree = run(table(td(text("$d_{\\mathrm{model}}$"))));
    const math = findMath(tree);
    expect(math).toEqual({ display: false, latex: "d_{\\mathrm{model}}" });
  });

  it("识别 $$...$$ 为 math-display", () => {
    const tree = run(table(td(text("$$x^2$$"))));
    expect(findMath(tree)).toEqual({ display: true, latex: "x^2" });
  });

  it("把一格里的文本与公式切开,文本保留", () => {
    const tree = run(table(td(text("params $\\times 10^6$"))));
    const cell = tree.children[0].children[0].children[0];
    expect(cell.children).toHaveLength(2);
    expect(cell.children[0]).toEqual(text("params "));
    expect(cell.children[1].properties.className).toContain("math-inline");
  });

  it("不处理表格外的 $...$(限定在 <table> 内)", () => {
    const tree = el("p", [text("$x$")]);
    run(tree);
    expect(findMath(tree)).toBeNull();
    expect(tree.children[0]).toEqual(text("$x$"));
  });

  it("不把货币样式的 $ 误判为公式", () => {
    const tree = run(table(td(text("costs $5 and $6 total"))));
    expect(findMath(tree)).toBeNull();
  });

  it("不处理表格内代码块里的 $", () => {
    const tree = run(table(td(el("code", [text("$x$")]))));
    expect(findMath(tree)).toBeNull();
  });
});
