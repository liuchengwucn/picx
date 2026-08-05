import { useEffect, useState } from "react";

// 调试开关，访问 ?debug=1 开启并记住（localStorage），?debug=0 关闭；
// 用于展示聚合器 relevance 分数。
// debug 参数不在路由 validateSearch 里，导航时会从 URL 消失，但 localStorage
// 已锁存，属预期；?debug=0 需整页加载才生效（本 hook 只在 effect 里读一次）。
const STORAGE_KEY = "picx-news-debug";

export function useDebugScores(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      const debugParam = new URLSearchParams(window.location.search).get(
        "debug",
      );
      if (debugParam === "1") {
        localStorage.setItem(STORAGE_KEY, "1");
      } else if (debugParam === "0") {
        localStorage.removeItem(STORAGE_KEY);
      }
      setEnabled(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // 隐私模式 Safari 等环境下 localStorage 可能抛错，保持默认关闭
    }
  }, []);

  return enabled;
}
