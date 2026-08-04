/**
 * 清洗社区抓取镜像 feed（Anthropic Research 页面）的标题拼接杂质。
 * 抓取器把「日期 + 分类 + 标题 + 文章描述」无分隔地拼进 <title>，
 * 且日期与分类两种先后顺序都出现过；部分条目本身是干净的，需原样保留。
 */

// 白名单需人工维护：Anthropic 若新增分类，这里要同步补充，否则新分类前缀剥不掉
const CATEGORIES = [
  "Frontier Red Team",
  "Economic Research",
  "Societal Impacts",
  "Alignment",
  "Interpretability",
  "Policy",
] as const;

// 抓取拼接的日期前缀，形如 "Jul 28, 2026"
const DATE_PREFIX = /^[A-Z][a-z]{2} \d{1,2}, \d{4}/;
const DATE_ONLY = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

// 标题与尾随描述的拼接点：小写字母紧跟「大写+小写」。lookahead 用 [A-Z][a-z]
// 而非仅 [A-Z] 是有意的——避免 "OpenAI" 这类品牌驼峰（n 后跟大写 A、I）被误切。
const JUNCTION = /[a-z](?=[A-Z][a-z])/g;
// 拼接点之后至少要有这么长的文本才视为文章描述，避免误切标题内部的驼峰
const MIN_DESCRIPTION_LENGTH = 40;
// 拼上来的尾随文本是文章描述——完整句子、以句末标点收尾（含抓取器截断的省略号，可带右引号）；
// 而真标题里 "GitHub"/"PyTorch" 这类驼峰品牌之后的残余不会以句末标点结尾，借此区分。
// 已知残余误伤窗口：疑问式真标题（以 ? 结尾）恰好含驼峰品牌且尾段 ≥40 字符时仍会被误切，
// 属启发式固有代价；story 标题由下游 LLM 重写，影响仅限时间线原始条目
const SENTENCE_END = /[.?!…]["”]?$/;
// 前缀层数理论上不定（日期/分类可叠加、顺序不定），剥到剥不动为止；上限只是防御性护栏
const MAX_STRIP_PASSES = 8;

/** 返回清洗后的标题；null 表示该条目是抓取到的导航杂质，应整条丢弃。 */
export function cleanScrapedResearchTitle(title: string): string | null {
  let text = title;
  let stripped = false;
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass++) {
    const date = text.match(DATE_PREFIX);
    // 日期后紧跟非空格字符才是拼接杂质
    if (date && text.length > date[0].length && text[date[0].length] !== " ") {
      text = text.slice(date[0].length);
      stripped = true;
      continue;
    }
    const category = CATEGORIES.find((c) => text.startsWith(c));
    // 分类后紧跟大写字母（含日期开头）才剥；跟空格则是正常标题开头
    // （如 "Alignment faking in LLMs"），必须保留
    if (category && /^[A-Z]/.test(text.slice(category.length))) {
      text = text.slice(category.length);
      stripped = true;
      continue;
    }
    break;
  }
  // 仅在确认是拼接标题（剥过前缀）时才切尾部拼接的文章描述，
  // 避免误伤本就干净的标题
  if (stripped) {
    for (const match of text.matchAll(JUNCTION)) {
      const cutAt = match.index + 1;
      const tail = text.slice(cutAt);
      if (tail.length >= MIN_DESCRIPTION_LENGTH && SENTENCE_END.test(tail)) {
        text = text.slice(0, cutAt);
        break;
      }
    }
  }
  const result = text.trim();
  if (!result) return null;
  // 纯分类名或纯日期的条目是抓取到的页面导航/元数据，不是文章
  if ((CATEGORIES as readonly string[]).includes(result)) return null;
  if (DATE_ONLY.test(result)) return null;
  return result;
}
