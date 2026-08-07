import { describe, expect, it } from "vitest";
import {
  analyzeGarbledSubSup,
  cleanMineruMarkdown,
  fixLigatureLoss,
  unwrapGarbledSubSup,
} from "./mineru-clean";

describe("fixLigatureLoss", () => {
  it("repairs common ffi/ff ligature misreads", () => {
    expect(fixLigatureLoss("an eficient difusion model")).toBe(
      "an efficient diffusion model",
    );
    expect(fixLigatureLoss("diferent diference difers dificulty")).toBe(
      "different difference differs difficulty",
    );
    expect(
      fixLigatureLoss("ofline ofsets oficial suficient sufixes trafic"),
    ).toBe("offline offsets official sufficient suffixes traffic");
    expect(fixLigatureLoss("bufers eforts afected aford coeficients")).toBe(
      "buffers efforts affected afford coefficients",
    );
    expect(fixLigatureLoss("shufled afinity eficacy efective")).toBe(
      "shuffled affinity efficacy effective",
    );
  });

  it("preserves capitalization of the first letter", () => {
    expect(fixLigatureLoss("Efective and Eficient Difusion")).toBe(
      "Effective and Efficient Diffusion",
    );
    expect(fixLigatureLoss("Ofline Oficial Diferent")).toBe(
      "Offline Official Different",
    );
  });

  it("fixes lowercase ofer but never the Hebrew name Ofer", () => {
    expect(fixLigatureLoss("they ofer several ofers")).toBe(
      "they offer several offers",
    );
    expect(fixLigatureLoss("Ofer Hadar and Ofer Lavi")).toBe(
      "Ofer Hadar and Ofer Lavi",
    );
  });

  it("fixes stifness but never whole-word stif or stifle/stifling", () => {
    expect(fixLigatureLoss("varying stifness levels")).toBe(
      "varying stiffness levels",
    );
    // 不设整词 stif 规则：全语料唯一命中是残缺文献行的误伤（Demystif… 丢字母）。
    expect(fixLigatureLoss("Dem stif in multi-a ent debate")).toBe(
      "Dem stif in multi-a ent debate",
    );
    expect(fixLigatureLoss("stifles motion while stifling growth")).toBe(
      "stifles motion while stifling growth",
    );
    expect(fixLigatureLoss("Stifler appears again")).toBe(
      "Stifler appears again",
    );
  });

  it("does not touch already-correct words", () => {
    const text = "efficient diffusion differs offline official stiffness";
    expect(fixLigatureLoss(text)).toBe(text);
  });

  it("requires a word boundary before the prefix", () => {
    // 词中出现的 ofer/difer 片段不应被替换。
    expect(fixLigatureLoss("woofer proliferation")).toBe(
      "woofer proliferation",
    );
  });

  it("is idempotent", () => {
    const input = "an Eficient difusion model that ofers diferent stifness";
    const once = fixLigatureLoss(input);
    expect(fixLigatureLoss(once)).toBe(once);
  });
});

describe("unwrapGarbledSubSup", () => {
  it("unwraps mid-word split instances (rule B)", () => {
    expect(unwrapGarbledSubSup("Cl<sub>a</sub>ssic<sub>a</sub>l")).toBe(
      "Classical",
    );
    expect(unwrapGarbledSubSup("l<sub>anguage mo</sub>del")).toBe(
      "language model",
    );
    expect(unwrapGarbledSubSup("Vis<sub>ual</sub>ization")).toBe(
      "Visualization",
    );
  });

  it("unwraps runs of >=3 whitespace-separated letter tags (rule A)", () => {
    expect(
      unwrapGarbledSubSup(
        "<sup>The</sup> <sup>robot</sup> <sup>successfully</sup> <sup>places</sup>",
      ),
    ).toBe("The robot successfully places");
  });

  it("keeps runs of only two letter tags", () => {
    const text = "τ<sub>pos</sub> τ<sub>neg</sub>";
    expect(unwrapGarbledSubSup(text)).toBe(text);
  });

  it("preserves legitimate subscript/superscript usages", () => {
    for (const text of [
      "BERT<sub>BASE</sub>",
      "τ<sub>pos</sub>",
      "f<sub>match</sub>",
      "H<sub>2</sub>O",
      "Alice<sup>1,2</sup>",
      "as shown in<sup>[1]</sup>",
      "L<sub>continuous</sub>",
      "M<sub>pan</sub> and M<sub>tgt</sub>",
      "ϕ<sub>SDF</sub>",
    ]) {
      expect(unwrapGarbledSubSup(text)).toBe(text);
    }
  });

  it("keeps letter tags followed by punctuation (rule B needs a trailing letter)", () => {
    const text = "from Query<sub>src</sub>, we derive";
    expect(unwrapGarbledSubSup(text)).toBe(text);
  });

  it("unwraps all letter tags in a saturated document (rule C)", () => {
    // 20 处词中切断（达到饱和阈值）+ 1 个本来合法的字母下标。
    const garbled = Array.from(
      { length: 20 },
      (_, i) => `wor<sub>d</sub>s${i}`,
    ).join(" ");
    const doc = `${garbled} plus legal ϕ<sub>SDF</sub> here`;
    const out = unwrapGarbledSubSup(doc);
    expect(out).not.toContain("<sub>");
    expect(out).toContain("ϕSDF");
  });

  it("keeps digit-bearing tags even in saturated documents", () => {
    const garbled = Array.from(
      { length: 20 },
      (_, i) => `wor<sub>d</sub>s${i}`,
    ).join(" ");
    const doc = `${garbled} with H<sub>2</sub>O and note<sup>[1]</sup>`;
    const out = unwrapGarbledSubSup(doc);
    expect(out).toContain("H<sub>2</sub>O");
    expect(out).toContain("<sup>[1]</sup>");
  });

  it("leaves unclosed tags untouched", () => {
    const text = "broken <sub>abc and more text";
    expect(unwrapGarbledSubSup(text)).toBe(text);
  });

  it("leaves tags with multiline content untouched", () => {
    // 内容含换行不满足字母型约束（字符类不含 \n），视为非字母型标签保留。
    const text = "wor<sub>a\nb</sub>d";
    expect(unwrapGarbledSubSup(text)).toBe(text);
  });

  it("treats empty tags as non-letter tags that break runs", () => {
    // <sub></sub> 无字母，非字母型：断开连排串，两侧不足 3 个则整体保留。
    const text = "<sup>a</sup> <sub></sub> <sup>b</sup> <sup>c</sup>";
    expect(unwrapGarbledSubSup(text)).toBe(text);
  });

  it("unwraps without inserting spaces", () => {
    expect(unwrapGarbledSubSup("sho<sup>great</sup>potentia")).toBe(
      "shogreatpotentia",
    );
  });

  it("is idempotent", () => {
    const doc =
      "Cl<sub>a</sub>ssic<sub>a</sub>l text, <sup>a</sup> <sup>b</sup> <sup>c</sup>, legal ϕ<sub>SDF</sub> and H<sub>2</sub>O";
    const once = unwrapGarbledSubSup(doc);
    expect(unwrapGarbledSubSup(once)).toBe(once);
  });
});

describe("analyzeGarbledSubSup", () => {
  it("counts rule A+B hits and reports saturation", () => {
    const clean = analyzeGarbledSubSup(
      "BERT<sub>BASE</sub> and H<sub>2</sub>O",
    );
    expect(clean.hits).toBe(0);
    expect(clean.saturated).toBe(false);

    const garbled = analyzeGarbledSubSup(
      Array.from({ length: 20 }, () => "wor<sub>d</sub>s").join(" x "),
    );
    expect(garbled.hits).toBe(20);
    expect(garbled.saturated).toBe(true);
  });
});

describe("cleanMineruMarkdown", () => {
  it("unwraps tags before fixing ligatures so recombined words get repaired", () => {
    // difusion 被标签切成 dif<sub>usio</sub>n：先展开成 difusion，再修成 diffusion。
    expect(cleanMineruMarkdown("dif<sub>usio</sub>n model")).toBe(
      "diffusion model",
    );
  });

  it("applies both cleanups and leaves legal content untouched", () => {
    expect(
      cleanMineruMarkdown(
        "An eficient method<sup>[1]</sup> for H<sub>2</sub>O with Cl<sub>a</sub>ssic<sub>a</sub>l flavor",
      ),
    ).toBe(
      "An efficient method<sup>[1]</sup> for H<sub>2</sub>O with Classical flavor",
    );
  });

  it("is idempotent", () => {
    const input =
      "Eficient dif<sub>usio</sub>n with <sup>a</sup> <sup>b</sup> <sup>c</sup> and ϕ<sub>SDF</sub>";
    const once = cleanMineruMarkdown(input);
    expect(cleanMineruMarkdown(once)).toBe(once);
  });
});
