/**
 * MinerU 转写乱码的确定性清洗（落盘前应用，见 parseMineruZip）。
 *
 * 实测（2026-08，全量 513 篇生产语料）MinerU 对部分 PDF 有系统性转写错误，
 * pipeline / vlm 两后端同样复现，无法靠换后端解决。两类症状：
 *
 * A. ff/ffi 连字误读：`efficient`→`eficient`、`diffusion`→`difusion` 等。
 *    用词典式前缀替换修复（fixLigatureLoss）。
 * B. x 字高字母被误判为上下标：`Cl<sub>a</sub>ssic<sub>a</sub>l`、
 *    `<sup>The</sup> <sup>robot</sup> ...`。用分层规则展开（unwrapGarbledSubSup）。
 *
 * 两个函数都是纯函数且幂等。清洗顺序：先展开标签，连字修复才能覆盖被标签
 * 切断重组后的词。
 */

interface LigatureRule {
  /** 乱码前缀（小写形态，\b 锚定，向后自然覆盖各种词尾变化）。 */
  from: string;
  to: string;
  /** 仅匹配小写（`Ofer` 是希伯来人名，不能动）。 */
  lowercaseOnly?: boolean;
}

/**
 * 规则表基于全语料计数实测（difusion 2965、diferen 2472、eficien 2023 …）。
 * 所有规则 from[0] === to[0]，替换时保留首字母大小写即可。
 */
const LIGATURE_RULES: LigatureRule[] = [
  { from: "eficien", to: "efficien" },
  { from: "eficac", to: "efficac" },
  { from: "efectiv", to: "effectiv" },
  { from: "difer", to: "differ" }, // 覆盖 diferen/diference/difers 等
  { from: "dificult", to: "difficult" },
  { from: "difus", to: "diffus" },
  { from: "ofline", to: "offline" },
  { from: "ofset", to: "offset" },
  { from: "oficial", to: "official" },
  { from: "suficien", to: "sufficien" },
  { from: "sufix", to: "suffix" },
  { from: "trafic", to: "traffic" },
  { from: "bufer", to: "buffer" },
  { from: "efort", to: "effort" },
  { from: "afect", to: "affect" },
  { from: "aford", to: "afford" },
  { from: "coeficien", to: "coefficien" },
  { from: "shufl", to: "shuffl" },
  { from: "afinity", to: "affinity" },
  { from: "ofer", to: "offer", lowercaseOnly: true },
  // stiff 类只修 stifness 前缀，绝不能碰 stifle/stifling/Stifler（语料实存）。
  // 不设整词 \bstif\b 规则：全语料唯一命中是重灾篇残缺文献行里的
  // "Dem stif"（疑为 Demystif… 丢字母），净收益为负。
  { from: "stifness", to: "stiffness" },
];

const COMPILED_LIGATURE_RULES = LIGATURE_RULES.map((rule) => {
  const first = rule.lowercaseOnly
    ? rule.from[0]
    : `[${rule.from[0].toUpperCase()}${rule.from[0]}]`;
  return {
    rule,
    regex: new RegExp(`\\b${first}${rule.from.slice(1)}`, "g"),
  };
});

/** 仅用于测试与标定：暴露规则表与逐条正则。 */
export const ligatureRulesForTesting = COMPILED_LIGATURE_RULES;

/**
 * 症状 A：词典式连字修复。纯函数、幂等（修复后的词都含双 f，
 * \b 锚定的单 f 前缀不会再命中）。
 */
export function fixLigatureLoss(text: string): string {
  let out = text;
  for (const { rule, regex } of COMPILED_LIGATURE_RULES) {
    out = out.replace(regex, (match) => match[0] + rule.to.slice(1));
  }
  return out;
}

// ---------------------------------------------------------------------------

/**
 * 「字母型标签」内容约束：仅 [A-Za-z .,\-\[\]'] 且至少一个字母。
 * 不含数字 —— 数字排除保住作者脚注 <sup>1,2</sup>、化学式 H<sub>2</sub>O、
 * 引用 <sup>[1]</sup>。
 */
const LETTER_CONTENT_RE = /^[A-Za-z .,\-[\]']*$/;
const HAS_LETTER_RE = /[A-Za-z]/;

/**
 * 规则 A：≥3 个仅空白分隔的连续字母型标签视为乱码连排串。
 * 阈值 3 为初始值，标定确认：2 个相邻字母下标在合法文档（如变量对
 * τ<sub>pos</sub> τ<sub>neg</sub>）中真实存在，3 起未见合法用例。
 */
const RUN_MIN_LENGTH = 3;

/**
 * 规则 C：单篇文档规则 A+B 命中数达到该值即视为「饱和文档」（PCSD 类重灾篇，
 * 实测单篇可达数千处），该篇所有字母型标签全部展开，接受少量合法字母下标
 * 被展平的代价。阈值 20 为初始值，标定确认：命中的文档最低 20+，
 * 未饱和文档命中数远低于此，无需调整。
 */
const SATURATION_THRESHOLD = 20;

// 大小写敏感是有意的：全语料标定中仅出现小写 <sub>/<sup> 标签。
// 内容 [^<]* 只匹配非嵌套标签对，嵌套时外层不命中。
const TAG_PAIR_RE = /<(sub|sup)>([^<]*)<\/\1>/g;

interface TagInstance {
  start: number;
  end: number;
  content: string;
  letter: boolean;
}

function scanTags(markdown: string): TagInstance[] {
  const tags: TagInstance[] = [];
  for (const m of markdown.matchAll(TAG_PAIR_RE)) {
    const content = m[2];
    tags.push({
      start: m.index,
      end: m.index + m[0].length,
      content,
      letter: LETTER_CONTENT_RE.test(content) && HAS_LETTER_RE.test(content),
    });
  }
  return tags;
}

/**
 * 标出规则 A / B 命中的标签下标集合。检测基于原文计数（先测后动）。
 *
 * 规则 B 只作用于字母型标签：语料中的词中切断实例内容均为纯字母，
 * 而含数字的下标（x<sub>2</sub> 等）都是合法用法，不应被两侧小写字母误伤。
 */
function markGarbled(markdown: string, tags: TagInstance[]): Set<number> {
  const marked = new Set<number>();

  // 规则 A：连排串。相邻（列表序即文本序）字母型标签之间仅空白（含空串）
  // 才延续同一串；任何非字母型标签或非空白间隔都会断串。
  let run: number[] = [];
  const flush = () => {
    if (run.length >= RUN_MIN_LENGTH) {
      for (const i of run) {
        marked.add(i);
      }
    }
    run = [];
  };
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (!tag.letter) {
      flush();
      continue;
    }
    if (run.length > 0) {
      const prev = tags[run[run.length - 1]];
      if (!/^\s*$/.test(markdown.slice(prev.end, tag.start))) {
        flush();
      }
    }
    run.push(i);
  }
  flush();

  // 规则 B：词中切断。开标签紧前是 [a-z]、内容以 [a-z] 开头、闭标签紧后是
  // [a-z]。`Query<sub>src</sub>,` 闭标签后是逗号，不满足条件，天然保留。
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (!tag.letter) {
      continue;
    }
    const before = markdown[tag.start - 1] ?? "";
    const after = markdown[tag.end] ?? "";
    if (
      /[a-z]/.test(before) &&
      /^[a-z]/.test(tag.content) &&
      /[a-z]/.test(after)
    ) {
      marked.add(i);
    }
  }

  return marked;
}

/** 仅用于测试与标定：规则 A+B 命中数与是否触发饱和展开。 */
export function analyzeGarbledSubSup(markdown: string): {
  hits: number;
  saturated: boolean;
  letterTagCount: number;
} {
  const tags = scanTags(markdown);
  const hits = markGarbled(markdown, tags).size;
  return {
    hits,
    saturated: hits >= SATURATION_THRESHOLD,
    letterTagCount: tags.filter((t) => t.letter).length,
  };
}

/**
 * 症状 B：展开乱码 sub/sup 标签。展开 = 用内容原样替换标签对，不插入空格
 * （已知美观缺陷：`<sup>great</sup>potentia`→`greatpotentia`，接受）。
 *
 * 幂等：被展开的实例不再有标签；保留的合法标签在第二遍中命中条件不变
 * （规则 B 要求闭标签紧后是字母，故被展开内容不会与残留标签直接相邻）。
 * 注意：若存在嵌套标签，幂等不成立（内层展开后外层才变得可匹配），
 * 但 MinerU 输出无嵌套标签，全语料两遍清洗实测零变化。
 */
export function unwrapGarbledSubSup(markdown: string): string {
  const tags = scanTags(markdown);
  if (tags.length === 0) {
    return markdown;
  }

  const marked = markGarbled(markdown, tags);
  // 规则 C：饱和文档全量展开所有字母型标签。
  const saturated = marked.size >= SATURATION_THRESHOLD;
  const toUnwrap: number[] = [];
  for (let i = 0; i < tags.length; i++) {
    if (saturated ? tags[i].letter : marked.has(i)) {
      toUnwrap.push(i);
    }
  }
  if (toUnwrap.length === 0) {
    return markdown;
  }

  let out = "";
  let pos = 0;
  for (const i of toUnwrap) {
    const tag = tags[i];
    out += markdown.slice(pos, tag.start) + tag.content;
    pos = tag.end;
  }
  out += markdown.slice(pos);
  return out;
}

/** MinerU markdown 落盘前的完整清洗：先展开乱码标签，再修复连字。 */
export function cleanMineruMarkdown(markdown: string): string {
  return fixLigatureLoss(unwrapGarbledSubSup(markdown));
}
