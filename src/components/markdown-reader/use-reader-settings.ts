import { useCallback, useEffect, useRef, useState } from "react";

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

// 默认值按长文可读性研究取:行宽落在 45~75 字符的推荐区间上沿(Bringhurst;Dyson &
// Haselgrove 2001),字号取 18px(Rello et al. CHI 2016 的眼动实验里大字号占优),行距 1.5
// 是 WCAG 1.4.8 AAA 的段内行距下限。左对齐而非两端对齐:网页缺乏印刷级断字质量,
// 两端对齐会拉伸词间距形成"文字河流"。衬线/无衬线在屏幕上无实证差异,取无衬线是取向选择。
export const READER_DEFAULTS: ReaderSettings = {
  font: "sans",
  fontSize: 18,
  measure: 76,
  lineHeight: 1.5,
  textAlign: "left",
};

export const FONT_SIZE_RANGE = { min: 15, max: 26, step: 1 } as const;
export const MEASURE_RANGE = { min: 60, max: 104, step: 4 } as const;
export const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.2, step: 0.1 } as const;

// 2026-08 换默认排版时从 "reader-settings" 提到 v2:旧 hook 一挂载就把当时的默认值
// 写进每个访客的 localStorage,存量里「打开过原文 tab」和「真的调过设置」无从分辨,
// 沿用旧键就等于新默认永远送不出去。换键让所有人从新默认重新开始,代价是当初真正
// 调过设置的人被清一次。旧键的残留值不再读取,留在浏览器里自然沉底。
const STORAGE_KEY = "reader-settings-v2";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 枚举项的兜底一律回落到 READER_DEFAULTS,不要硬编码具体值 —— 否则改默认值时这里会
// 悄悄失同步,localStorage 里存了脏值的用户拿到的是旧默认而不是新默认。
function sanitize(input: Partial<ReaderSettings>): ReaderSettings {
  return {
    font:
      input.font === "sans" || input.font === "serif"
        ? input.font
        : READER_DEFAULTS.font,
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
    textAlign:
      input.textAlign === "justify" || input.textAlign === "left"
        ? input.textAlign
        : READER_DEFAULTS.textAlign,
  };
}

function sameSettings(a: ReaderSettings, b: ReaderSettings): boolean {
  return (
    a.font === b.font &&
    a.fontSize === b.fontSize &&
    a.measure === b.measure &&
    a.lineHeight === b.lineHeight &&
    a.textAlign === b.textAlign
  );
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

/**
 * 落盘只记录「与默认不同的偏好」:等于默认就删掉记录,而不是把默认值写进去。
 *
 * 两条都重要 —— 只在用户动作时调用(不在挂载时),且等于默认时不留痕。「没有记录」
 * 因此始终意味着「没有偏好」,以后再调 READER_DEFAULTS 能直接送达这批人,不必再像
 * v2 那样靠换键把所有人一起清掉。reset 走同一条路径,语义正好是「清除偏好」。
 */
function persist(next: ReaderSettings): void {
  try {
    if (sameSettings(next, READER_DEFAULTS)) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // 忽略写入失败(隐私模式等)
  }
}

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(READER_DEFAULTS);
  // update 要基于「当前值」合并 patch,但落盘需要拿到合并后的结果。副作用不能写进
  // setState 的 updater(StrictMode 会重复调用),所以用 ref 持有当前值。
  const settingsRef = useRef(settings);

  // 仅在客户端首帧后从 localStorage 注入,避免 SSR 水合不一致。注意这里不落盘。
  useEffect(() => {
    const loaded = loadSettings();
    settingsRef.current = loaded;
    setSettings(loaded);
  }, []);

  const apply = useCallback((next: ReaderSettings) => {
    settingsRef.current = next;
    setSettings(next);
    persist(next);
  }, []);

  const update = useCallback(
    (patch: Partial<ReaderSettings>) => {
      apply(sanitize({ ...settingsRef.current, ...patch }));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(READER_DEFAULTS);
  }, [apply]);

  return { settings, update, reset };
}
