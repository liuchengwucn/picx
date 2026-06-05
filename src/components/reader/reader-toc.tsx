import { type RefObject, useEffect, useState } from "react";
import { cn } from "#/lib/utils";

export interface TocItem {
  id: string;
  text: string;
  level: number;
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
      headings.map((h) => ({
        id: h.id,
        text: h.textContent ?? "",
        level: Number(h.tagName[1]),
      })),
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

interface TocListProps {
  items: TocItem[];
  activeId: string;
  onJump: (id: string) => void;
  className?: string;
}

export function TocList({ items, activeId, onJump, className }: TocListProps) {
  if (items.length === 0) {
    return null;
  }
  return (
    <nav aria-label="Table of contents" className={cn("reader-toc", className)}>
      <ul className="reader-toc-list">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id} data-level={item.level}>
              <button
                type="button"
                onClick={() => onJump(item.id)}
                aria-current={isActive ? "location" : undefined}
                className={cn("reader-toc-link", isActive && "is-active")}
                title={item.text}
              >
                <span className="reader-toc-tick" aria-hidden />
                <span className="reader-toc-text">{item.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
