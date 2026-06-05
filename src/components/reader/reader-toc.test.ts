import { describe, expect, it } from "vitest";
import { buildTree, headingLevel, type TocItem } from "./reader-toc";

describe("headingLevel", () => {
  it("从章节编号前缀推断深度", () => {
    expect(headingLevel("1 Introduction", 2)).toBe(1);
    expect(headingLevel("3 Model Architecture", 2)).toBe(1);
    expect(headingLevel("3.1 Encoder and Decoder Stacks", 2)).toBe(2);
    expect(headingLevel("3.2.1 Scaled Dot-Product Attention", 2)).toBe(3);
  });

  it("容忍编号后的可选小数点", () => {
    expect(headingLevel("3. Model Architecture", 2)).toBe(1);
    expect(headingLevel("3.1. Encoder", 2)).toBe(2);
  });

  it("无编号标题回退到标签级别", () => {
    // h1 文档标题 → 第 0 层(根)
    expect(headingLevel("Attention Is All You Need", 1)).toBe(0);
    // 无编号的顶层小节(Abstract / References)与「1 Introduction」同级
    expect(headingLevel("Abstract", 2)).toBe(1);
    expect(headingLevel("References", 2)).toBe(1);
    expect(headingLevel("Acknowledgements", 2)).toBe(1);
  });

  it("不误把非编号开头当作章节号", () => {
    // 「3D」后面没有空格,不应识别为编号
    expect(headingLevel("3D Reconstruction", 2)).toBe(1);
  });
});

describe("buildTree", () => {
  // 模拟 MinerU 把各级标题都输出成 h2 的真实情形:层级要靠编号恢复。
  const items: TocItem[] = [
    { id: "t", text: "Attention Is All You Need", level: 0 },
    { id: "abs", text: "Abstract", level: 1 },
    { id: "1", text: "1 Introduction", level: 1 },
    { id: "3", text: "3 Model Architecture", level: 1 },
    { id: "3.1", text: "3.1 Encoder and Decoder Stacks", level: 2 },
    { id: "3.2", text: "3.2 Attention", level: 2 },
    { id: "3.2.1", text: "3.2.1 Scaled Dot-Product Attention", level: 3 },
    { id: "3.2.2", text: "3.2.2 Multi-Head Attention", level: 3 },
    { id: "ref", text: "References", level: 1 },
  ];

  it("把扁平列表按编号恢复出层级", () => {
    const tree = buildTree(items);
    // 单一 h1 标题作为根
    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.id).toBe("t");

    // 顶层小节都挂在标题下
    const topIds = root.children.map((n) => n.id);
    expect(topIds).toEqual(["abs", "1", "3", "ref"]);

    // 「3」下嵌 3.1 / 3.2
    const model = root.children.find((n) => n.id === "3");
    expect(model?.children.map((n) => n.id)).toEqual(["3.1", "3.2"]);

    // 「3.2」下嵌 3.2.1 / 3.2.2
    const attn = model?.children.find((n) => n.id === "3.2");
    expect(attn?.children.map((n) => n.id)).toEqual(["3.2.1", "3.2.2"]);
  });
});
