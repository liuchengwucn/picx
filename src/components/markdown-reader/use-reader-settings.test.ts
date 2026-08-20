// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { READER_DEFAULTS, useReaderSettings } from "./use-reader-settings";

// Node 22 起 globalThis 上有个实验性 localStorage，它让 jsdom 不再注入自己的实现，
// 于是 vitest 的 jsdom 环境里 window.localStorage 是 undefined（见 quote-card-content
// .test.ts 的同类注释）。别的测试遇到这个是想绕开它，这里被测的恰恰就是落盘行为，
// 只能自己造一个最小 Storage。
function installMemoryStorage(): void {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

installMemoryStorage();

const STORAGE_KEY = "reader-settings-v2";
const LEGACY_KEY = "reader-settings";

/** 2026-08 换默认排版之前的值，当年被 hook 无条件写进每个访客的 localStorage */
const LEGACY_BLOB = JSON.stringify({
  font: "serif",
  fontSize: 19,
  measure: 92,
  lineHeight: 1.8,
  textAlign: "justify",
});

function stored(): unknown {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe("useReaderSettings 的落盘策略", () => {
  it("从未设置过时给出默认值，且挂载不落盘", () => {
    const { result } = renderHook(() => useReaderSettings());

    expect(result.current.settings).toEqual(READER_DEFAULTS);
    // 关键：挂载本身不能留下记录，否则「没有偏好」会被伪装成「选了当时的默认」，
    // 日后再调 READER_DEFAULTS 就送不到这批人手上
    expect(stored()).toBeNull();
  });

  it("旧键里的存量值一律不读，所有人从新默认重新开始", () => {
    window.localStorage.setItem(LEGACY_KEY, LEGACY_BLOB);

    const { result } = renderHook(() => useReaderSettings());

    expect(result.current.settings).toEqual(READER_DEFAULTS);
    expect(stored()).toBeNull();
  });

  it("真正调整过的偏好原样保留", () => {
    const custom = {
      font: "serif",
      fontSize: 22,
      measure: 92,
      lineHeight: 1.8,
      textAlign: "justify",
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));

    const { result } = renderHook(() => useReaderSettings());

    expect(result.current.settings).toEqual(custom);
    expect(stored()).toEqual(custom);
  });

  it("用户改动会落盘", () => {
    const { result } = renderHook(() => useReaderSettings());

    act(() => result.current.update({ fontSize: 22 }));

    expect(result.current.settings.fontSize).toBe(22);
    expect(stored()).toEqual({ ...READER_DEFAULTS, fontSize: 22 });
  });

  it("改回默认值等于清除偏好，不留记录", () => {
    const { result } = renderHook(() => useReaderSettings());

    act(() => result.current.update({ fontSize: 22 }));
    act(() => result.current.update({ fontSize: READER_DEFAULTS.fontSize }));

    expect(result.current.settings).toEqual(READER_DEFAULTS);
    expect(stored()).toBeNull();
  });

  it("连续 update 基于最新值合并，不会丢掉前一次改动", () => {
    const { result } = renderHook(() => useReaderSettings());

    act(() => result.current.update({ fontSize: 22 }));
    act(() => result.current.update({ font: "serif" }));

    expect(result.current.settings).toEqual({
      ...READER_DEFAULTS,
      fontSize: 22,
      font: "serif",
    });
  });

  it("reset 清掉记录而不是写回默认值", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...READER_DEFAULTS, measure: 104 }),
    );
    const { result } = renderHook(() => useReaderSettings());

    act(() => result.current.reset());

    expect(result.current.settings).toEqual(READER_DEFAULTS);
    expect(stored()).toBeNull();
  });

  it("脏值回落到默认而不是硬编码的旧值", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ font: "comic", fontSize: 999, textAlign: "center" }),
    );

    const { result } = renderHook(() => useReaderSettings());

    expect(result.current.settings.font).toBe(READER_DEFAULTS.font);
    expect(result.current.settings.textAlign).toBe(READER_DEFAULTS.textAlign);
    expect(result.current.settings.fontSize).toBe(26); // FONT_SIZE_RANGE.max
  });
});
