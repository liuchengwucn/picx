/**
 * 主题模式工具:与全局 ThemeToggle / __root.tsx 的 THEME_INIT_SCRIPT 共用同一套机制
 * (localStorage 键 "theme" + html class light/dark + data-theme + colorScheme),
 * 供阅读器设置面板等处复用,避免重复实现。
 */
export type ThemeMode = "light" | "dark" | "auto";

export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "auto";
  }
  const stored = window.localStorage.getItem("theme");
  if (stored === "light" || stored === "dark" || stored === "auto") {
    return stored;
  }
  return "auto";
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "auto") {
    return mode;
  }
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  if (mode === "auto") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
  root.style.colorScheme = resolved;
}

export function setThemeMode(mode: ThemeMode): void {
  applyThemeMode(mode);
  if (typeof window !== "undefined") {
    window.localStorage.setItem("theme", mode);
  }
}
