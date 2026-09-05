import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customClientStrategies } from "#/paraglide/runtime";
import "#/lib/locale-client-strategy";

// 注册的是 runtime 会在 getLocale() 解析链里调用的 handler；这里直接拿出来调，
// 避免 import runtime 的 getLocale 撞上 Node 下缺失的 document/localStorage。
function negotiate() {
  const handler = customClientStrategies.get("custom-negotiate");
  if (!handler) throw new Error("custom-negotiate not registered");
  return handler.getLocale();
}

describe("client custom-negotiate strategy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers under the same name the server strategy uses", () => {
    expect(customClientStrategies.has("custom-negotiate")).toBe(true);
  });

  it("is the very first import of router.tsx so it precedes any getLocale()", () => {
    // 注册晚于第一次 getLocale() 的话首访又会落到 en 并被写进 cookie。biome 的
    // organizeImports 不会移动 side-effect import，但也不会替我们守住这条。
    const source = readFileSync(
      new URL("../router.tsx", import.meta.url),
      "utf8",
    );
    const firstImport = source.match(/^import\b.*$/m)?.[0];
    expect(firstImport).toBe('import "#/lib/locale-client-strategy";');
  });

  it("negotiates from navigator.languages with the shared mapping", () => {
    vi.stubGlobal("navigator", { languages: ["zh-HK", "en-US"] });
    expect(negotiate()).toBe("zh-TW");

    vi.stubGlobal("navigator", { languages: ["fr-FR", "ja"] });
    expect(negotiate()).toBe("ja");
  });

  it("yields to the next strategy when nothing matches or outside a browser", () => {
    vi.stubGlobal("navigator", { languages: ["fr-FR", "de"] });
    expect(negotiate()).toBeUndefined();

    // Workers 里的 navigator 只有 userAgent
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(negotiate()).toBeUndefined();
  });
});
