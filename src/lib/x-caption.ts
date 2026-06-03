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
