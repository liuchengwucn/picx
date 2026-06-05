/**
 * 阅读器专用的 rehype 插件(手写极简 hast 遍历,不额外引依赖):
 * - rehypeHeadingIds:给 h1–h3 生成稳定 slug id,供目录跳转与滚动高亮锚定。
 * - rehypeUnwrapImages:把「仅含一张图片的段落」拆出 <p>,以便 <figure> 不被非法嵌套进 <p>。
 * - rehypeTableMath:把 HTML 表格里残留的 `$...$`/`$$...$$` 文本转成 math-inline/math-display
 *   span,交给 rehype-katex 渲染。MinerU 的表格是 HTML(<table>),而 remark-math 是 mdast 阶段
 *   插件、看不到 rehype-raw 解析出来的 HTML 文本,导致表格内公式渲染不出来。需在 rehype-katex 之前跑。
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

/**
 * 把一段纯文本里的 `$...$`(行内)与 `$$...$$`(行间)切成 [文本, 公式 span, 文本, ...]。
 * 无公式时返回 null。行内要求内容首尾非空白,以降低把货币符号/孤立 $ 误判为公式的概率。
 */
function splitTextMath(value: string): HastNode[] | null {
  if (!value.includes("$")) {
    return null;
  }
  const nodes: HastNode[] = [];
  let buf = "";
  let found = false;
  const flush = () => {
    if (buf) {
      nodes.push({ type: "text", value: buf });
      buf = "";
    }
  };
  let i = 0;
  const n = value.length;
  while (i < n) {
    const ch = value[i];
    // 转义的 \$ → 字面 $
    if (ch === "\\" && value[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }
    if (ch === "$") {
      const display = value[i + 1] === "$";
      const open = i + (display ? 2 : 1);
      let j = open;
      let close = -1;
      while (j < n) {
        if (value[j] === "\\") {
          j += 2;
          continue;
        }
        if (
          display ? value[j] === "$" && value[j + 1] === "$" : value[j] === "$"
        ) {
          close = j;
          break;
        }
        j += 1;
      }
      if (close !== -1) {
        const latex = value.slice(open, close);
        const valid = display
          ? latex.trim().length > 0
          : latex.length > 0 && latex === latex.trim() && !/\n/.test(latex);
        if (valid) {
          flush();
          nodes.push({
            type: "element",
            tagName: "span",
            properties: {
              className: display
                ? ["math", "math-display"]
                : ["math", "math-inline"],
            },
            children: [{ type: "text", value: latex.trim() }],
          });
          found = true;
          i = close + (display ? 2 : 1);
          continue;
        }
      }
      // 不是有效公式:把这个 $ 当字面字符,从下一位继续扫描
      buf += ch;
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return found ? nodes : null;
}

/** 仅在 <table> 子树内把残留的 $...$ 文本转成公式 span(限定范围以避免误伤正文/货币)。 */
function transformTableMath(node: HastNode, inTable: boolean): void {
  if (!node.children) {
    return;
  }
  // 代码块与已是公式的子树不处理
  if (
    node.tagName === "code" ||
    node.tagName === "pre" ||
    hasClassIncluding(node, "math") ||
    hasClassIncluding(node, "katex")
  ) {
    return;
  }
  const nowInTable = inTable || node.tagName === "table";
  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && nowInTable) {
      const split = splitTextMath(child.value ?? "");
      if (split) {
        next.push(...split);
        continue;
      }
    }
    if (child.type === "element") {
      transformTableMath(child, nowInTable);
    }
    next.push(child);
  }
  node.children = next;
}

export function rehypeTableMath() {
  return (tree: HastNode) => {
    transformTableMath(tree, false);
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
