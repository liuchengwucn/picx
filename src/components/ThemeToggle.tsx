import { useEffect, useState } from "react";
import * as m from "#/paraglide/messages";

type ThemeMode = "light" | "dark" | "auto";

function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "auto";
  }

  const stored = window.localStorage.getItem("theme");
  if (stored === "light" || stored === "dark" || stored === "auto") {
    return stored;
  }

  return "auto";
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;

  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);

  if (mode === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }

  document.documentElement.style.colorScheme = resolved;

  // 与 __root.tsx 的 THEME_INIT_SCRIPT / src/lib/theme.ts 同步
  // <meta id="theme-color">: 这是站内主题实际生效的路径(点击本组件的切换按钮,
  // 或系统偏好在 auto 模式下变化), 不同步的话 OS 状态栏/地址栏颜色就只会
  // 跟着系统偏好走, 忽略用户在站内手动选的 light/dark。
  const themeColorMeta = document.getElementById("theme-color");
  if (themeColorMeta) {
    themeColorMeta.setAttribute(
      "content",
      resolved === "dark" ? "#1a1816" : "#faf8f3",
    );
  }
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("auto");

  useEffect(() => {
    const initialMode = getInitialMode();
    setMode(initialMode);
    applyThemeMode(initialMode);
  }, []);

  useEffect(() => {
    if (mode !== "auto") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeMode("auto");

    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [mode]);

  function toggleMode() {
    const nextMode: ThemeMode =
      mode === "light" ? "dark" : mode === "dark" ? "auto" : "light";
    setMode(nextMode);
    applyThemeMode(nextMode);
    window.localStorage.setItem("theme", nextMode);
  }

  const label =
    mode === "auto"
      ? "Theme mode: auto (system). Click to switch to light mode."
      : `Theme mode: ${mode}. Click to switch mode.`;

  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={label}
      title={label}
      className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 sm:px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5 whitespace-nowrap"
    >
      <span className="hidden sm:inline">
        {mode === "auto"
          ? m.theme_auto()
          : mode === "dark"
            ? m.theme_dark()
            : m.theme_light()}
      </span>
      <span className="sm:hidden">
        {mode === "auto"
          ? m.theme_auto_short()
          : mode === "dark"
            ? m.theme_dark_short()
            : m.theme_light_short()}
      </span>
    </button>
  );
}
