const TWEET_MAX = 280;

const CATEGORY_HASHTAGS: Record<string, string> = {
  llm: "#LLM",
  nlp: "#NLProc",
  multimodal: "#Multimodal",
  vision: "#ComputerVision",
  generative: "#GenAI",
  "speech-audio": "#SpeechAI",
  "reinforcement-learning": "#ReinforcementLearning",
  agents: "#AIAgents",
  "reasoning-planning": "#Reasoning",
  "retrieval-rag": "#RAG",
  "robotics-3d": "#Robotics",
  "ml-theory": "#MachineLearning",
  efficiency: "#EfficientML",
  "data-benchmark": "#Benchmark",
  "alignment-safety": "#AISafety",
  "ai-for-science": "#AI4Science",
};

interface CaptionInput {
  tldr: string;
  categories: string[];
}

/**
 * 推文正文 = tldr + hashtags（从论文分类映射），不含链接。
 * 图片作为媒体附件上传（由调用方处理），图上已有 picx.dev 水印。
 */
export function buildTweetCaption(input: CaptionInput): string {
  const hashtags = input.categories
    .filter((c) => c !== "other")
    .map((c) => CATEGORY_HASHTAGS[c])
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  if (!hashtags) {
    let tldr = input.tldr.trim();
    if ([...tldr].length > TWEET_MAX) {
      tldr = `${[...tldr].slice(0, TWEET_MAX - 1).join("")}…`;
    }
    return tldr;
  }

  const hashtagLen = [...hashtags].length;
  const budget = TWEET_MAX - hashtagLen - 2; // "\n\n" = 2

  let tldr = input.tldr.trim();
  if ([...tldr].length > budget) {
    tldr = `${[...tldr].slice(0, budget - 1).join("")}…`;
  }

  return tldr ? `${tldr}\n\n${hashtags}` : hashtags;
}

/**
 * tldr 缺失时的发推兜底:把 Markdown 摘要压成单行纯文本
 *(去标题/强调/链接/图片/代码/列表符号/LaTeX 记号并合并空白),
 * 长度截断交给 buildTweetCaption。仅在 tldr 生成曾失败时使用。
 */
export function summaryToTweetText(summary: string): string {
  return summary
    .replace(/```[\s\S]*?```/g, " ") // 代码块
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片(须在链接之前)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接保留文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // 标题
    .replace(/^\s{0,3}>\s?/gm, "") // 引用
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "") // 列表符号
    .replace(/`([^`]*)`/g, "$1") // 行内代码
    .replace(/[*_~]/g, "") // 强调/删除线
    .replace(/\$+/g, "") // LaTeX $ 记号
    .replace(/\s+/g, " ") // 合并空白
    .trim();
}
