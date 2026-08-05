import { useCallback, useEffect, useState } from "react";

export type ReaderFont = "serif" | "sans";
export type ReaderAlign = "left" | "justify";

export interface ReaderSettings {
  /** 正文字体:衬线(适合长文阅读)/ 无衬线 */
  font: ReaderFont;
  /** 正文字号(px) */
  fontSize: number;
  /** 正文行宽(ch,约等于字符数) */
  measure: number;
  /** 行距(无单位倍数) */
  lineHeight: number;
  /** 文本对齐:左对齐 / 两端对齐 */
  textAlign: ReaderAlign;
}

export const READER_DEFAULTS: ReaderSettings = {
  font: "serif",
  fontSize: 19,
  measure: 80,
  lineHeight: 1.8,
  textAlign: "justify",
};

export const FONT_SIZE_RANGE = { min: 15, max: 26, step: 1 } as const;
export const MEASURE_RANGE = { min: 60, max: 104, step: 4 } as const;
export const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.2, step: 0.1 } as const;

const STORAGE_KEY = "reader-settings";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitize(input: Partial<ReaderSettings>): ReaderSettings {
  return {
    font: input.font === "sans" ? "sans" : "serif",
    fontSize: clamp(
      Number(input.fontSize) || READER_DEFAULTS.fontSize,
      FONT_SIZE_RANGE.min,
      FONT_SIZE_RANGE.max,
    ),
    measure: clamp(
      Number(input.measure) || READER_DEFAULTS.measure,
      MEASURE_RANGE.min,
      MEASURE_RANGE.max,
    ),
    lineHeight: clamp(
      Number(input.lineHeight) || READER_DEFAULTS.lineHeight,
      LINE_HEIGHT_RANGE.min,
      LINE_HEIGHT_RANGE.max,
    ),
    textAlign: input.textAlign === "justify" ? "justify" : "left",
  };
}

function loadSettings(): ReaderSettings {
  if (typeof window === "undefined") {
    return READER_DEFAULTS;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return READER_DEFAULTS;
    }
    return sanitize(JSON.parse(raw));
  } catch {
    return READER_DEFAULTS;
  }
}

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(READER_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  // 仅在客户端首帧后从 localStorage 注入,避免 SSR 水合不一致
  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 忽略写入失败(隐私模式等)
    }
  }, [settings, hydrated]);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => sanitize({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setSettings(READER_DEFAULTS);
  }, []);

  return { settings, update, reset };
}
