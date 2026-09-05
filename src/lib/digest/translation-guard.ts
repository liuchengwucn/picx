// src/lib/digest/translation-guard.ts
//
// 翻译出口的语言校验。
//
// 背景（2026-08-29 生产第 3 期）：cheap 模型在 translateDigest 里会整段「照抄
// 原文」——formal-math / efficient-attention / coding-agent 三期的 ja 正文假名
// 占比 0%（其余 18 期是 57%~69%），24/169 条 ja 推荐语是中文，部分 ja 标题夹
// 中文。同源现象在论文管线也见过（关 reasoning 会诱发错语言输出）。prompt 拦不
// 住这种偶发，只能在出口按脚本成分验收。
//
// 判据刻意只用「脚本成分」这种粗粒度信号，不做语种分类模型：目标是零误报地抓
// 「整段没翻」，不是评估翻译质量。误报的代价很实：翻译 step 重试耗尽后
// digest-workflow 会 fallback 回 zh-cn，反而把中文写进 ja 槽。

/**
 * 简体独有汉字：日语新字体与之**不同码位**的字。
 *
 * 前 10 组是偏旁整体简化的字族（讠钅饣纟门马车页见贝），日语从未简化这些偏旁，
 * 因此整族零误报，是最可靠的信号来源。
 * 最后一组是逐字核过的独体简化字——凡是日语新字体与简体**同形**的（学 数 体
 * 点 断 号 独 当 属 装 残 来 条 画 参 静 称 概 状 双 角 困 宝 国 声 台 机 担 据
 * 径 旧 斗 楼 欧 灯 炉 礼 碍 猫 猪 与 万 会 …）一律不收：它们在真正的日语里高频
 * 出现，收进来就是误报。改动本表后必须重跑 translation-guard.test.ts 里的
 * 真实语料用例。
 */
const SIMPLIFIED_ONLY = [
  // 讠（言）
  "计订讣认讥讨让讪训议讯记讲讳讶讷许讹论讼讽设访诀证诂评诅识诈诉诊词译诒试诗诘诚诛话诞诠询该详诧诫诬语误诱诲说诵请诸诺读诽课谀谁调谅谆谈谊谋谍谎谏谐谒谓谕谗谙谚谜谢谣谤谦谨谩谪谬谭谱谴",
  // 钅（金）
  "钇针钉钊钓钝钞钟钠钢钥钦钧钩钮钱钳钻钾铀铁铂铃铅铆铉铌铍铐铜铝铠铡铢铣铨铬铭铰银铸铺链销锁锂锄锅锆锈锋锌锐锑锗错锚锡锢锣锤锥锦锭键锯锰锻镀镁镇镉镊镍镐镑镖镜镭镰镶",
  // 饣（食）
  "饥饭饮饰饱饲饴饵饶饷饺饼馄馅馆馈馋馍馏馒馔",
  // 纟（糸）
  "纠纡红纣纤纥约级纨纪纫纬纯纰纱纲纳纵纶纷纸纹纺纽线练组绅细织终绊绍绎经绑绒结绕绘给绚络绝绞统绢绣继绩绪绫续绮绰绳维绵绷绸综绽绿缀缄缅缆缉缎缓缔缕编缘缚缝缠缤缩缪缮缰缴",
  // 门（門）
  "门闩闪闭问闯闰闲闷闸闹闺闻阀阁阂阅阆阈阉阎阐阔阕阖",
  // 马（馬）
  "马驭驮驯驰驱驳驴驶驷驹驻驼驾驿骂骄骅骆骇骈验骋骏骑骗骚骛骜骝骠骡骤骥",
  // 车（車）
  "车轧轨轩轫转轭轮软轰轱轴轶轻载轼轿辄辅辆辈辉辊辍辐辑输辕辖辗辙",
  // 页（頁）
  "页顶顷项顺须顽顾顿颁颂颅领颇颈颉颊颌频颓颔颖颗题颚颜额颞颠颢颤颧",
  // 见（見）
  "见观规觅视览觉觊觎觐",
  // 贝（貝）
  "贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贴贵贷贸费贺贻贼贾贿赁赂赃资赅赈赊赋赌赎赏赐赔赖赘赚赛赝赞赠赡赢赣",
  // 独体简化字（逐字核对日语新字体不同形）
  "个为从时东长专业们义习书买卖头乐无处备复优传价众亿应变单战实边过还进运远连选达违适递遗迈层岁岛帮带师帅库广开弹归录总恶惊执扩扫拟择挥损换摄敌显晓杀权极构标样桥检欢毁气汉泽洁测浓满滤灭灵热爱环现电疗监盘确离种积稳竞笔简类紧罢职联脑脏舰艰艺节苏药获营虑补丰乡凤凭击则创劝动务劳势卫历厅压县发叶听启员响团园图圣坏块坚壳夹夺奖妆娱孙宁宠审宫对寻导尘岂币帐庄庆废异张强彻忆态怀怜恋恳恼惧惨愤懒户扑扬扰抛护报拥挂挤捞搅摆摇斋杂杨树栋梦毕毙沟洒润涨渐渔渗湾溃滚滨滩烂烦烧犹狮狱玛畅疯盏盖睁矫码硕础碱祸穷窃窍窜窝竖筛签篮粮龙齿龄鸟鸡鸣鸦鸭鸽鹅鹏鹤鹰鸿鱼鲁鲜鲸风飘飞韦难",
].join("");

const SIMPLIFIED_ONLY_CHARS = new Set([...SIMPLIFIED_ONLY]);

/**
 * 简体独有字的容错。真实语料里「好的」ja/zh-tw 文本也会零星漏 1 个（18 期
 * 干净 ja 正文里实测各出现 0~1 个：经/证/间/专/块/选/择 各 1 次；干净 zh-tw
 * 正文里 0~1 个），而没翻的整段是数百个（244/282/327）。判别间隔极宽，取 2。
 */
export const SIMPLIFIED_TOLERANCE = 2;

/**
 * 假名占比阈值（分母＝假名＋汉字，ASCII 与中日标点都不计）。
 *
 * 实测 18 期干净 ja：正文 57%~69%，标题 18%~72%；没翻的三期正文与标题都是
 * 精确的 0%。正文阈值留到 0.15（最低干净值的 1/3.8），标题因为短且汉字密度
 * 高（moe #1 只有 18%）压到 0.08，推荐语按标题口径。
 */
export const JA_KANA_MIN_RATIO = {
  title: 0.08,
  content: 0.15,
  note: 0.08,
} as const;

/**
 * 假名占比的最小可判分母。短到只有几个汉字的字段（推荐语可能通篇是英文术语
 * 加一两个汉字）算出来的比例是噪声，直接放行，只留简体字判据兜底。
 */
const KANA_JUDGE_MIN_CJK = { title: 8, content: 40, note: 8 } as const;

/** en 字段允许的 CJK 占比上限（论文标题里的个别汉字不该触发） */
export const EN_CJK_MAX_RATIO = 0.01;
/** en 字段的 CJK 绝对下限：不足这么多字一律不判，避免专名里的单字误伤 */
const EN_CJK_MIN_ABS = 4;

function isKana(cp: number): boolean {
  // 平假名 U+3041-309F、片假名 U+30A0-30FF（含长音符 ー）
  return (cp >= 0x3041 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff);
}

function isHan(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // 基本区
    (cp >= 0x3400 && cp <= 0x4dbf) || // 扩展 A
    (cp >= 0xf900 && cp <= 0xfaff) // 兼容汉字
  );
}

interface ScriptStats {
  kana: number;
  han: number;
  simplifiedOnly: number;
  /** 码位总数（含 ASCII），只给 en 的占比判据用 */
  total: number;
}

function scan(text: string): ScriptStats {
  let kana = 0;
  let han = 0;
  let simplifiedOnly = 0;
  let total = 0;
  for (const ch of text) {
    total++;
    const cp = ch.codePointAt(0) ?? 0;
    if (isKana(cp)) {
      kana++;
    } else if (isHan(cp)) {
      han++;
      if (SIMPLIFIED_ONLY_CHARS.has(ch)) simplifiedOnly++;
    }
  }
  return { kana, han, simplifiedOnly, total };
}

export type TranslationTarget = "zh-tw" | "en" | "ja";

export interface TranslationPayload {
  title: string;
  content: string;
  notes: Record<string, string>;
}

export interface TranslationLeak {
  /** "title" | "content" | `note:<key>` */
  field: string;
  /** 人类可读的判据，进重试 prompt 与错误信息 */
  reason: string;
}

type FieldKind = "title" | "content" | "note";

function checkJa(kind: FieldKind, text: string): string | null {
  const s = scan(text);
  if (s.simplifiedOnly > SIMPLIFIED_TOLERANCE) {
    return `contains ${s.simplifiedOnly} Simplified-Chinese-only characters`;
  }
  const cjk = s.kana + s.han;
  if (cjk >= KANA_JUDGE_MIN_CJK[kind]) {
    const ratio = s.kana / cjk;
    if (ratio < JA_KANA_MIN_RATIO[kind]) {
      return `kana ratio ${(ratio * 100).toFixed(1)}% of ${cjk} CJK chars, below ${(JA_KANA_MIN_RATIO[kind] * 100).toFixed(0)}% — reads as Chinese, not Japanese`;
    }
  }
  return null;
}

function checkZhTw(text: string): string | null {
  const s = scan(text);
  if (s.simplifiedOnly > SIMPLIFIED_TOLERANCE) {
    return `contains ${s.simplifiedOnly} Simplified-Chinese-only characters (must be Traditional)`;
  }
  return null;
}

function checkEn(text: string): string | null {
  const s = scan(text);
  const cjk = s.kana + s.han;
  if (
    cjk >= EN_CJK_MIN_ABS &&
    s.total > 0 &&
    cjk / s.total >= EN_CJK_MAX_RATIO
  ) {
    return `contains ${cjk} CJK characters (${((cjk / s.total) * 100).toFixed(1)}%) — not translated to English`;
  }
  return null;
}

/**
 * 逐字段判「这份译文其实没翻」。返回违规字段列表（空数组＝通过）。
 *
 * en 只判正文与推荐语、不判标题：标题短，一个引用的中文专名就能顶破 1% 的线，
 * 而 en 在生产里从没出过没翻的情况，不值得为它冒误报的险。
 */
export function detectTranslationLeak(
  target: TranslationTarget,
  payload: TranslationPayload,
): TranslationLeak[] {
  const leaks: TranslationLeak[] = [];
  const push = (field: string, reason: string | null) => {
    if (reason) leaks.push({ field, reason });
  };

  if (target === "ja") {
    push("title", checkJa("title", payload.title));
    push("content", checkJa("content", payload.content));
    for (const [key, note] of Object.entries(payload.notes ?? {})) {
      push(`note:${key}`, checkJa("note", note));
    }
  } else if (target === "zh-tw") {
    push("title", checkZhTw(payload.title));
    push("content", checkZhTw(payload.content));
    for (const [key, note] of Object.entries(payload.notes ?? {})) {
      push(`note:${key}`, checkZhTw(note));
    }
  } else {
    push("content", checkEn(payload.content));
    for (const [key, note] of Object.entries(payload.notes ?? {})) {
      push(`note:${key}`, checkEn(note));
    }
  }
  return leaks;
}

/** 把违规列表拼成给模型看的重试指令 */
export function leakRetryInstruction(
  target: TranslationTarget,
  leaks: TranslationLeak[],
): string {
  const langName = {
    "zh-tw": "Traditional Chinese",
    en: "English",
    ja: "Japanese",
  }[target];
  const lines = leaks
    .slice(0, 20)
    .map((l) => `- ${l.field}: ${l.reason}`)
    .join("\n");
  return [
    `RETRY: your previous output left these fields untranslated (still Simplified Chinese):`,
    lines,
    leaks.length > 20 ? `- ...and ${leaks.length - 20} more fields` : "",
    `Every value MUST be rendered in ${langName}. Do not copy the source text.`,
    target === "ja"
      ? "Japanese prose uses kana (hiragana/katakana) for particles and inflections — output with no kana at all is not Japanese."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
