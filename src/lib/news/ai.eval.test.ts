import { describe, expect, it } from "vitest";
import { generateStoryContent, judgeAssignment } from "./ai";

// 手动评估脚本（golden cases）：不进 CI，需显式 opt-in 才会跑（避免任何配了
// OPENAI_API_KEY 的开发者环境意外触发真实调用）。
// 运行：NEWS_EVAL=1 OPENAI_API_KEY=sk-... OPENAI_MODEL=... mac npx vitest run src/lib/news/ai.eval.test.ts
const apiKey = process.env.OPENAI_API_KEY;
const enabled = !!process.env.NEWS_EVAL && !!apiKey;
const config = {
  openaiApiKey: apiKey ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiModel: process.env.OPENAI_MODEL,
  geminiApiKey: "",
  // base URL 走 Cloudflare AI Gateway 时需要 cf-aig-authorization
  cfApiToken: process.env.CF_API_TOKEN,
};

const CANDIDATES = [
  {
    title: "DeepSeek releases DeepSeek-V4 with 1M context",
    summary:
      "DeepSeek launched V4, a new MoE flagship model with a 1M-token context window.",
  },
  {
    title: "Anthropic publishes interpretability paper on feature circuits",
    summary: "New research tracing circuits in production LLMs.",
  },
];

describe.skipIf(!enabled)("judgeAssignment golden cases", () => {
  it("merges same-event coverage from another source", async () => {
    const idx = await judgeAssignment(
      {
        title: "DeepSeek V4 tops open-model leaderboards on day one",
        excerpt:
          "The newly released DeepSeek-V4 already leads several benchmarks.",
      },
      CANDIDATES,
      config,
    );
    expect(idx).toBe(0);
  }, 30_000);
  it("does not merge a different model's news", async () => {
    const idx = await judgeAssignment(
      {
        title: "Qwen 4 announced with new attention variant",
        excerpt: "Alibaba's Qwen team announced Qwen 4.",
      },
      CANDIDATES,
      config,
    );
    expect(idx).toBeNull();
  }, 30_000);
  it("does not merge criticism of an unrelated event", async () => {
    const idx = await judgeAssignment(
      {
        title: "Why 1M context windows are mostly marketing",
        excerpt: "An essay arguing long-context claims rarely hold up.",
      },
      CANDIDATES,
      config,
    );
    expect(idx).toBeNull();
  }, 30_000);
  it("merges replication coverage of the same interpretability paper", async () => {
    const idx = await judgeAssignment(
      {
        title:
          "Anthropic's new interpretability paper on feature circuits gets replicated",
        excerpt:
          "An independent team reproduced the feature-circuit tracing results.",
      },
      CANDIDATES,
      config,
    );
    expect(idx).toBe(1);
  }, 30_000);
});

// 真实线上数据（2026-08 机器之心两篇标题党案例）：验证 story 标题从正文取实质
// 信息、不沿用原标题的宣传口吻。断言故意宽松（禁感叹号 + 关键概念出现），
// 具体措辞好坏靠人工看 console 输出判断。
const CLICKBAIT_TWOREK = {
  sourceName: "机器之心",
  title: "离开OpenAI和Google后，两位大模型核心负责人决定卷下一代架构",
  excerpt:
    "曾经最相信强化学习的人之一，如今却认为：强化学习没有把我们带到 AGI。 Jerry Tworek 曾是 OpenAI 内部坚定的「强化学习最大主义者」。在 GPT-3、GPT-4 之后，他一直相信，大模型缺少的最后一块拼图就是大规模强化学习。只要把这条路线真正推到极致，剩下的问题或许都会被解决。2024 年时，他甚至判断，AGI 可能会在 2025 年到来。 后来，他真的站到了这场实验的中心。 模型一代代变强，评测分数不断上涨，复杂推理能力也迅速提升。但 Jerry 看到的另一个事实是：实验室里的进展，并没有完整转化为现实世界中的可靠能力。训练任务越来越难，模型越来越会考试，却仍然无法适应大量模糊、变化且从未被预先定义的问题。 这让他开始怀疑，问题可能不只是强化学习还不够大，而是今天的模型根本缺少一种更基础的能力： 它们不会在进入真实世界后继续学习。 带着这个判断，Jerry 与 Rohan Anil 共同创办了 Core Automation。Rohan 曾是谷歌 Gemini 的预训练负责人之一，也长期研究优化算法、模型架构和底层计算系统。一个来自大规模强化学习，一个来自预训练与优化，两人的经历几乎覆盖了当前大模型的两条核心路线。 但他们决定不再沿着这两条路线继续加码。 当整个行业仍在扩大 Transformer、增加推理算力、追逐更强的编程智能体时，他们选择追问一个更根本的问题：如果模型只能在实验室中完成学习，需要人类不断收集数据、重新训练和发布新版本，它真的能够走向 AGI 吗？",
};

const CLICKBAIT_ACTIVEVISION = {
  sourceName: "机器之心",
  title: "Fable5仅做对3.5%！大模型会看图，但还没有主动视觉",
  excerpt:
    "01｜视觉，为什么是一条闭环？ 人类看图时，不会先在大脑中拍下一张「截图」，再闭眼推理。思考过程会不断引导我们的目光：找到一个线索，形成一个假设，再回到图像里验证它。 这套闭环有长期的心理学基础。经典著作《眼动与视觉》（1967）发现，同一幅画在不同问题下会引发截然不同的眼动轨迹：观看并非由图像单向决定，任务目标和中间假设会持续重定向注视。 这种能力和真实应用息息相关。车间工作需要在一桌相似的零件中找到目标、检查差异；医生要在整张影像中逐区搜索并统计可疑病灶；旅行者要沿地图跨过一个个岔路，持续确认自己仍在正确路径上。每一次新发现都会改变下一次查看的区域，下一次观察又会反过来修正判断；只看懂大意远远不够。 基于以上动机，我们发布了 ActiveVision——一个专门测量这种「主动观察」能力的视觉推理基准。ActiveVision 包含 17 个任务和 3 类能力： ● 全局扫描（distributed scanning）：在整张图里找全、数全 ● 顺序追踪（sequential traversal）：沿一条结构一步步走到底 ● 属性迁移（visual attribute transfer）：跨区域记住并比较细微视觉属性",
};

describe.skipIf(!enabled)("generateStoryContent anti-clickbait", () => {
  it("derives continual-learning substance instead of 「卷下一代架构」", async () => {
    const content = await generateStoryContent([CLICKBAIT_TWOREK], config);
    console.log("[eval tworek]", content.title, content.summary["zh-cn"]);
    for (const title of Object.values(content.title)) {
      expect(title).not.toMatch(/[!！]/);
    }
    expect(content.title["zh-cn"]).not.toContain("卷下一代");
    // 核心实质：持续学习 / 新公司 Core Automation，至少命中其一
    expect(content.title["zh-cn"] + content.title.en).toMatch(
      /持续学习|continual learning|Core Automation/i,
    );
  }, 60_000);

  it("leads with the benchmark finding instead of 「仅做对3.5%！」", async () => {
    const content = await generateStoryContent(
      [CLICKBAIT_ACTIVEVISION],
      config,
    );
    console.log("[eval activevision]", content.title, content.summary["zh-cn"]);
    for (const title of Object.values(content.title)) {
      expect(title).not.toMatch(/[!！]/);
    }
    expect(content.title["zh-cn"]).not.toContain("会看图");
    // 正文实质：新基准 ActiveVision 测量主动观察/视觉闭环能力
    expect(content.title["zh-cn"] + content.title.en).toMatch(
      /ActiveVision|主动观察|主动视觉探索|active (perception|vision|observation)/i,
    );
  }, 60_000);
});
