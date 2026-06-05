/**
 * 阅读器专用的 rehype 插件(手写极简 hast 遍历,不额外引依赖):
 * - rehypeHeadingIds:给 h1–h3 生成稳定 slug id,供目录跳转与滚动高亮锚定。
 * - rehypeUnwrapImages:把「仅含一张图片的段落」拆出 <p>,以便 <figure> 不被非法嵌套进 <p>。
 * - rehypeNotranslate:给公式(.katex / .math)与代码(pre / code)打 translate="no" + notranslate,
 *   保证「沉浸式翻译」等网页插件不破坏公式与代码。
 */

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function textContent(node: HastNode): string {
  if (node.type === "text") {
    return node.value ?? "";
  }
  if (node.children) {
    return node.children.map(textContent).join("");
  }
  return "";
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // 保留字母数字下划线、CJK、空白与连字符
      .replace(/[^\w一-鿿぀-ヿ\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

function classList(node: HastNode): string[] {
  const cn = node.properties?.className;
  if (Array.isArray(cn)) {
    return cn.filter((c): c is string => typeof c === "string");
  }
  if (typeof cn === "string") {
    return cn.split(/\s+/).filter(Boolean);
  }
  return [];
}

function hasClassIncluding(node: HastNode, needle: string): boolean {
  return classList(node).some((c) => c.includes(needle));
}

function walk(node: HastNode, visit: (n: HastNode) => void): void {
  visit(node);
  node.children?.forEach((child) => {
    walk(child, visit);
  });
}

export function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const seen = new Map<string, number>();
    walk(tree, (node) => {
      if (
        node.type !== "element" ||
        !node.tagName ||
        !/^h[1-3]$/.test(node.tagName)
      ) {
        return;
      }
      node.properties = node.properties ?? {};
      if (node.properties.id) {
        return;
      }
      const base = slugify(textContent(node)) || "section";
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      node.properties.id = count === 0 ? base : `${base}-${count}`;
    });
  };
}

export function rehypeUnwrapImages() {
  return (tree: HastNode) => {
    walk(tree, (node) => {
      if (!node.children) {
        return;
      }
      node.children = node.children.flatMap((child) => {
        if (child.type !== "element" || child.tagName !== "p") {
          return [child];
        }
        const meaningful = (child.children ?? []).filter(
          (c) => !(c.type === "text" && (c.value ?? "").trim() === ""),
        );
        const onlyImage =
          meaningful.length === 1 &&
          meaningful[0].type === "element" &&
          meaningful[0].tagName === "img";
        return onlyImage ? meaningful : [child];
      });
    });
  };
}

export function rehypeNotranslate() {
  return (tree: HastNode) => {
    walk(tree, (node) => {
      if (node.type !== "element" || !node.tagName) {
        return;
      }
      const isTarget =
        node.tagName === "code" ||
        node.tagName === "pre" ||
        hasClassIncluding(node, "katex") ||
        hasClassIncluding(node, "math");
      if (!isTarget) {
        return;
      }
      node.properties = node.properties ?? {};
      node.properties.translate = "no";
      const classes = classList(node);
      if (!classes.includes("notranslate")) {
        classes.push("notranslate");
      }
      node.properties.className = classes;
    });
  };
}
