import { ChevronRight } from "lucide-react";
import { type RefObject, useEffect, useMemo, useState } from "react";
import { cn } from "#/lib/utils";

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TocNode extends TocItem {
  children: TocNode[];
}

/**
 * 计算标题在目录中的层级。MinerU 常把各级章节标题输出成同一 HTML 级别(如全是 h2),
 * 仅按标签级别会让目录全成同级兄弟、失去层次。优先用章节编号前缀("3.2.1" → 第 3 层)
 * 推断深度,无编号时回退到标签级别(h1→0, h2→1, h3→2)。
 */
export function headingLevel(text: string, tagLevel: number): number {
  const match = text.match(/^\s*(\d+(?:\.\d+)*)\.?\s+\S/);
  if (match) {
    return match[1].split(".").length;
  }
  return tagLevel - 1;
}

/**
 * 从已渲染的文章 DOM 中提取 h1–h3 生成目录,并用 IntersectionObserver 做滚动高亮(scroll-spy)。
 * 跳转用 scrollIntoView,锚点偏移由 CSS scroll-margin-top 负责。
 */
export function useToc(
  articleRef: RefObject<HTMLElement | null>,
  contentKey: string,
) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey 变化即内容更新,需在重渲染后的 DOM 上重建目录
  useEffect(() => {
    const el = articleRef.current;
    if (!el) {
      return;
    }

    const headings = Array.from(
      el.querySelectorAll<HTMLElement>("h1, h2, h3"),
    ).filter((h) => h.id);

    setItems(
      headings.map((h) => {
        const text = h.textContent ?? "";
        return {
          id: h.id,
          text,
          level: headingLevel(text, Number(h.tagName[1])),
        };
      }),
    );

    if (headings.length === 0) {
      setActiveId("");
      return;
    }

    setActiveId((prev) => prev || headings[0].id);

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (entry.isIntersecting) {
            visible.set(id, entry.boundingClientRect.top);
          } else {
            visible.delete(id);
          }
        }
        if (visible.size > 0) {
          // 取当前可视区内最靠上的标题作为当前章节
          const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0][0];
          setActiveId(top);
        }
      },
      // 把激活带收窄到视口上部,贴近真实阅读焦点
      { rootMargin: "-88px 0px -68% 0px", threshold: [0, 1] },
    );

    for (const h of headings) {
      observer.observe(h);
    }
    return () => {
      observer.disconnect();
    };
  }, [articleRef, contentKey]);

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }
    setActiveId(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof history !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
  };

  return { items, activeId, jumpTo };
}

/** 把扁平的 h1–h3 列表按层级构造成树,供折叠。 */
export function buildTree(items: TocItem[]): TocNode[] {
  const root: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const item of items) {
    const node: TocNode = { ...item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      root.push(node);
    }
    stack.push(node);
  }
  return root;
}

function subtreeHasId(node: TocNode, id: string): boolean {
  return (
    node.id === id || node.children.some((child) => subtreeHasId(child, id))
  );
}

interface TocListProps {
  items: TocItem[];
  activeId: string;
  onJump: (id: string) => void;
  className?: string;
}

export function TocList({ items, activeId, onJump, className }: TocListProps) {
  const tree = useMemo(() => buildTree(items), [items]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Table of contents" className={cn("reader-toc", className)}>
      <TocTree
        nodes={tree}
        depth={0}
        activeId={activeId}
        collapsed={collapsed}
        onToggle={toggle}
        onJump={onJump}
      />
    </nav>
  );
}

function TocTree({
  nodes,
  depth,
  activeId,
  collapsed,
  onToggle,
  onJump,
}: {
  nodes: TocNode[];
  depth: number;
  activeId: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onJump: (id: string) => void;
}) {
  return (
    <ul className="reader-toc-list" data-depth={depth}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isOpen = !collapsed.has(node.id);
        const isActive = node.id === activeId;
        // 折叠且当前阅读位置落在该子树内时,给父节点一个轻提示。
        const hasActiveHidden =
          hasChildren && !isOpen && subtreeHasId(node, activeId);

        return (
          <li key={node.id}>
            <div className="reader-toc-row">
              {hasChildren ? (
                <button
                  type="button"
                  className="reader-toc-fold"
                  onClick={() => onToggle(node.id)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? "Collapse section" : "Expand section"}
                >
                  <ChevronRight
                    className={cn("reader-toc-chevron", isOpen && "is-open")}
                  />
                </button>
              ) : (
                <span className="reader-toc-fold-spacer" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => onJump(node.id)}
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "reader-toc-link",
                  isActive && "is-active",
                  hasActiveHidden && "has-active",
                )}
                title={node.text}
              >
                <span className="reader-toc-text">{node.text}</span>
              </button>
            </div>
            {hasChildren && isOpen ? (
              <TocTree
                nodes={node.children}
                depth={depth + 1}
                activeId={activeId}
                collapsed={collapsed}
                onToggle={onToggle}
                onJump={onJump}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
