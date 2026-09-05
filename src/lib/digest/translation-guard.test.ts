import { describe, expect, it } from "vitest";
import {
  detectTranslationLeak,
  leakRetryInstruction,
} from "./translation-guard";

// 以下片段全部取自生产 2026-08 的真实简报（moe #1 / coding-agent #3 /
// pretrain-data #1、#2），保留 markdown 链接与英文术语的原始密度——判据的分母
// 就是被这些 ASCII 内容稀释过的，用手写的"纯净"日文测不出真实边界。

const GOOD_JA_TITLE =
  "第1期：稀疏専門家構造の検証可能性——負荷分散、因果監査、システム実測";
// pretrain-data #2 的 ja 标题：与 zh-cn 逐字相同，一个假名都没有
const LEAKED_JA_TITLE = "第2期：重复存在反效果区间——数据受限配比的新判据";

const GOOD_JA_CONTENT =
  "システム側では、[TEMPO](https://arxiv.org/abs/2608.13057) がEP分散におけるメモリ制約と計算制約の二つの区間が共存する現実を明らかにした。実際のバッチの92–100%が両方の区間を含み、トークンカウントプロキシは区間の混合点で体系的に失敗する。また、相図を用いて適応分散がいつ投資に値するかを予測する。[MOSAIC](https://arxiv.org/abs/2608.10605) はアーキテクチャと並列レイアウトをハードウェアの実効FLOPs予算のもとで共同最適化する。";
const LEAKED_JA_CONTENT =
  "怀疑派证据继续收紧。[Rethinking the Evaluation of Harness Evolution](https://arxiv.org/abs/2607.12227) 给出迄今最干净的预算匹配对照：在匹配的反馈与推理预算下，自动 harness 演化并不一致优于并行采样、顺序精化等 test-time scaling 基线，且演化 harness 过拟合搜索集（held-out 平均仅 +0.6pp）。这与第 1 期的怀疑派结论一致。";

const GOOD_JA_NOTE =
  "2.8Tパラメータ、896専門家（活性化16）の極端なスパース最前線の規模で、Quantile Balancing（QB）を提案——router-scoreの分位数から直接専門家バイアスを設定し、目標負荷を正確に一致させる。";
const LEAKED_JA_NOTE =
  "把整个 SEC EDGAR 档案（估计 550B token，公开 152B）重建为保布局、token 高效的 MultiMarkdown，显式保留表格、缩进与视觉层级，而这些正是此前 BeanCounter 等金融语料丢弃的。";

const GOOD_TW_CONTENT =
  "在系統側，[TEMPO](https://arxiv.org/abs/2608.13057) 揭示了 EP 分發中記憶體受限與計算受限雙區間並存的現實——92–100% 的真實批次同時包含兩個區間，token 計數代理在區間混合處系統性失效，並以相圖預測自適應分發何時值得投入。";
const LEAKED_TW_CONTENT =
  "在系统侧，[TEMPO](https://arxiv.org/abs/2608.13057) 揭示了 EP 分发中内存受限与计算受限双区间并存的现实——92–100% 的真实批次同时包含两个区间，token 计数代理在区间混合处系统性失效，并以相图预测自适应分发何时值得投入。";

const GOOD_EN_CONTENT =
  "On the system side, [TEMPO](https://arxiv.org/abs/2608.13057) reveals the reality that memory-bound and compute-bound regimes coexist in EP distribution—92–100% of real batches contain both regimes, and token-count proxies fail systematically at the mixing point.";
const GOOD_EN_NOTE =
  "At the extreme sparse frontier scale of 2.8T parameters and 896 experts (16 active), proposes Quantile Balancing (QB)—setting expert biases directly from router-score quantiles.";

const payload = (over: {
  title?: string;
  content?: string;
  notes?: Record<string, string>;
}) => ({
  title: over.title ?? "",
  content: over.content ?? "",
  notes: over.notes ?? {},
});

describe("detectTranslationLeak / ja", () => {
  it("passes a genuinely Japanese digest", () => {
    expect(
      detectTranslationLeak(
        "ja",
        payload({
          title: GOOD_JA_TITLE,
          content: GOOD_JA_CONTENT,
          notes: { "paper-1": GOOD_JA_NOTE },
        }),
      ),
    ).toEqual([]);
  });

  it("flags content left in Simplified Chinese", () => {
    const leaks = detectTranslationLeak(
      "ja",
      payload({ title: GOOD_JA_TITLE, content: LEAKED_JA_CONTENT }),
    );
    expect(leaks.map((l) => l.field)).toEqual(["content"]);
  });

  it("flags a title copied verbatim from the Chinese source", () => {
    const leaks = detectTranslationLeak(
      "ja",
      payload({ title: LEAKED_JA_TITLE, content: GOOD_JA_CONTENT }),
    );
    expect(leaks.map((l) => l.field)).toEqual(["title"]);
  });

  it("flags untranslated notes per key and keeps translated ones", () => {
    const leaks = detectTranslationLeak(
      "ja",
      payload({
        title: GOOD_JA_TITLE,
        content: GOOD_JA_CONTENT,
        notes: { good: GOOD_JA_NOTE, bad: LEAKED_JA_NOTE },
      }),
    );
    expect(leaks.map((l) => l.field)).toEqual(["note:bad"]);
  });

  it("does not judge kana ratio on fields with too little CJK to measure", () => {
    // 全 ASCII 的推荐语（纯术语堆叠）判不了，放行而不是误报
    expect(
      detectTranslationLeak(
        "ja",
        payload({
          notes: { x: "SGLang v0.5 + FP8 KV cache, 2.1x throughput." },
        }),
      ),
    ).toEqual([]);
  });

  it("tolerates a couple of stray simplified characters", () => {
    // 干净的 18 期里实测每篇会漏 0~1 个简体字（经/证/间/专…），不该判违规
    expect(
      detectTranslationLeak(
        "ja",
        payload({
          content: `${GOOD_JA_CONTENT}経路の选择はカーネル実装に依存する。`,
        }),
      ),
    ).toEqual([]);
  });
});

describe("detectTranslationLeak / zh-tw", () => {
  it("passes Traditional Chinese", () => {
    expect(
      detectTranslationLeak("zh-tw", payload({ content: GOOD_TW_CONTENT })),
    ).toEqual([]);
  });

  it("flags Simplified Chinese left in place", () => {
    const leaks = detectTranslationLeak(
      "zh-tw",
      payload({ content: LEAKED_TW_CONTENT }),
    );
    expect(leaks.map((l) => l.field)).toEqual(["content"]);
  });
});

describe("detectTranslationLeak / en", () => {
  it("passes English", () => {
    expect(
      detectTranslationLeak(
        "en",
        payload({ content: GOOD_EN_CONTENT, notes: { a: GOOD_EN_NOTE } }),
      ),
    ).toEqual([]);
  });

  it("flags CJK left in the English body", () => {
    const leaks = detectTranslationLeak(
      "en",
      payload({ content: LEAKED_TW_CONTENT, notes: { a: GOOD_EN_NOTE } }),
    );
    expect(leaks.map((l) => l.field)).toEqual(["content"]);
  });

  it("ignores an isolated CJK proper noun", () => {
    expect(
      detectTranslationLeak(
        "en",
        payload({
          content: `${GOOD_EN_CONTENT} The dataset is named 悟道 by its authors.`,
        }),
      ),
    ).toEqual([]);
  });

  it("does not judge the English title", () => {
    // en 标题短，一个引用的中文专名就能顶破 1%；生产从没出过 en 没翻的情况
    expect(
      detectTranslationLeak("en", payload({ title: LEAKED_JA_TITLE })),
    ).toEqual([]);
  });
});

describe("leakRetryInstruction", () => {
  it("names the offending fields and the target language", () => {
    const text = leakRetryInstruction("ja", [
      { field: "content", reason: "kana ratio 0.0%" },
      {
        field: "note:paper-2",
        reason: "contains 51 Simplified-Chinese-only characters",
      },
    ]);
    expect(text).toContain("Japanese");
    expect(text).toContain("content");
    expect(text).toContain("note:paper-2");
  });

  it("truncates a long field list", () => {
    const leaks = Array.from({ length: 25 }, (_, i) => ({
      field: `note:${i}`,
      reason: "untranslated",
    }));
    const text = leakRetryInstruction("zh-tw", leaks);
    expect(text).toContain("and 5 more fields");
    expect(text).not.toContain("note:24");
  });
});
