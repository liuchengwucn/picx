/**
 * AI 配置接口
 */
export interface AIConfig {
  openaiApiKey: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  geminiApiKey: string;
  geminiBaseUrl?: string;
  geminiModel?: string;
  cfApiToken?: string;
}


/**
 * 调用 OpenAI API 生成论文总结
 *
 * @param paperText 论文文本内容
 * @param config AI 配置
 * @param language 生成语言 ('en' 为英文, 'zh' 为中文)
 * @returns 论文总结文本（Markdown 格式）
 * @throws 如果生成失败则抛出错误
 */
export async function generateSummary(
  paperText: string,
  config: AIConfig,
  language: "en" | "zh" = "en",
): Promise<string> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5-mini";

  const languageInstruction =
    language === "zh"
      ? "请用中文回答。"
      : "Please respond in English.";

  const systemPrompt = `You are an expert at summarizing academic papers. Generate a comprehensive, well-structured summary in Markdown format.

${languageInstruction}

Structure your summary with the following sections:

## Summary (Overview)
Provide 3-5 key bullet points highlighting the main contributions and findings.

## Introduction and Theoretical Foundation
Explain the background, motivation, and theoretical basis of the research.

## Methodology
Describe the research methods, approaches, and techniques used.

## Empirical Validation / Results
Present the key experimental results, findings, and evidence.

## Theoretical and Practical Implications
Discuss the significance and impact of the findings.

## Conclusion
Summarize the main takeaways and future directions.

## Visual Summary (Optional)
If helpful, include a Mermaid diagram using \`\`\`mermaid code blocks to visualize key concepts or workflows.

Guidelines:
- Use proper Markdown formatting (headers, lists, bold, italic)
- Support LaTeX math formulas using $inline$ or $$display$$ notation
- Use code blocks with syntax highlighting when showing code
- Use blockquotes (>) for important quotes or definitions
- Be comprehensive but clear and well-organized`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    };

    // 如果配置了 Cloudflare API Token，添加 AI Gateway 认证头
    if (config.cfApiToken) {
      headers["cf-aig-authorization"] = `Bearer ${config.cfApiToken}`;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `Please summarize the following academic paper:\n\n${paperText}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI API request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    if (!data.choices || data.choices.length === 0) {
      throw new Error("No response from OpenAI API");
    }

    const summary = data.choices[0].message?.content?.trim();

    if (!summary) {
      throw new Error("Empty summary generated");
    }

    return summary;
  } catch (error) {
    console.error("Failed to generate summary:", error);
    throw new Error(
      `Summary generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 调用 OpenAI API 生成思维导图 Markdown 结构
 *
 * @param paperText 论文文本内容
 * @param config AI 配置
 * @returns 思维导图的 Markdown 表示（可选包含 Mermaid 图表）
 * @throws 如果生成失败则抛出错误
 */
export async function generateMindmapStructure(
  paperText: string,
  config: AIConfig,
): Promise<string> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5-mini";

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    };

    // 如果配置了 Cloudflare API Token，添加 AI Gateway 认证头
    if (config.cfApiToken) {
      headers["cf-aig-authorization"] = `Bearer ${config.cfApiToken}`;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an expert at creating structured mindmaps from academic papers. Generate a hierarchical mindmap using Markdown format. You can optionally use Mermaid syntax for visualization. Use clear, concise text for each node.",
          },
          {
            role: "user",
            content: `Create a mindmap for the following paper using Markdown format.

You can use either:
1. Markdown lists (recommended for simplicity):
# Paper Title
- Main Topic 1
  - Subtopic 1.1
  - Subtopic 1.2
- Main Topic 2
  - Subtopic 2.1
    - Detail 2.1.1

2. Or Mermaid mindmap syntax (optional):
\`\`\`mermaid
mindmap
  root((Paper Title))
    Main Topic 1
      Subtopic 1.1
    Main Topic 2
\`\`\`

3. Or combine both formats

Guidelines:
- Organize by: Background, Methodology, Key Findings, Contributions, Limitations
- Keep node text concise (max 5-7 words per node)
- Use 2-4 main branches, each with 2-4 sub-branches
- Maximum 3 levels of depth

Paper content:
${paperText}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI API request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    if (!data.choices || data.choices.length === 0) {
      throw new Error("No response from OpenAI API");
    }

    const content = data.choices[0].message?.content?.trim();

    if (!content) {
      throw new Error("Empty mindmap structure generated");
    }

    return content;
  } catch (error) {
    console.error("Failed to generate mindmap structure:", error);
    throw new Error(
      `Mindmap structure generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 生成思维导图图片
 * 支持通过 OpenRouter 或直接调用 Gemini API
 *
 * @param mindmapMarkdown 思维导图的 Markdown 表示
 * @param config AI 配置
 * @returns 图片的 ArrayBuffer 数据和用于生成的 prompt
 * @throws 如果生成失败则抛出错误
 */
export async function generateMindmapImage(
  mindmapMarkdown: string,
  config: AIConfig,
): Promise<{ imageData: ArrayBuffer; prompt: string }> {
  const prompt = buildMindmapPrompt(mindmapMarkdown);

  // 检测是否使用 OpenRouter (通过 geminiBaseUrl 判断)
  const isOpenRouter = config.geminiBaseUrl?.includes("openrouter");

  if (isOpenRouter) {
    // 使用 OpenRouter API (OpenAI 兼容格式)
    return await generateMindmapImageWithOpenRouter(prompt, config);
  }

  // 使用原生 Gemini API
  return await generateMindmapImageWithGemini(prompt, config);
}

/**
 * 使用 OpenRouter API 生成思维导图图片
 * OpenRouter 支持通过 chat completions API 调用 Gemini 图像生成模型
 */
async function generateMindmapImageWithOpenRouter(
  prompt: string,
  config: AIConfig,
): Promise<{ imageData: ArrayBuffer; prompt: string }> {
  const baseUrl = config.geminiBaseUrl || "https://openrouter.ai/api/v1";
  const model = config.geminiModel || "google/gemini-3.1-flash-image-preview";

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.geminiApiKey}`,
    };

    // 如果配置了 Cloudflare API Token，添加 AI Gateway 认证头
    if (config.cfApiToken) {
      headers["cf-aig-authorization"] = `Bearer ${config.cfApiToken}`;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        modalities: ["image", "text"], // 关键：告诉 OpenRouter 需要生成图片
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          images?: Array<{
            image_url: { url: string };
          }>;
        };
      }>;
    };

    if (!data.choices || data.choices.length === 0) {
      throw new Error("No response from OpenRouter API");
    }

    const message = data.choices[0].message;

    // OpenRouter 返回的图片在 images 数组中
    if (!message?.images || message.images.length === 0) {
      throw new Error("No image data in OpenRouter response");
    }

    // 图片是 base64 data URL 格式: "data:image/png;base64,..."
    const imageDataUrl = message.images[0].image_url.url;
    const base64Match = imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);

    if (!base64Match) {
      throw new Error("Invalid image data URL format");
    }

    // 将 base64 转换为 ArrayBuffer
    const base64Data = base64Match[1];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return {
      imageData: bytes.buffer,
      prompt,
    };
  } catch (error) {
    console.error("Failed to generate mindmap image with OpenRouter:", error);
    throw new Error(
      `OpenRouter image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 使用原生 Gemini API 生成思维导图图片
 */
async function generateMindmapImageWithGemini(
  prompt: string,
  config: AIConfig,
): Promise<{ imageData: ArrayBuffer; prompt: string }> {
  const baseUrl =
    config.geminiBaseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const model = config.geminiModel || "gemini-3.1-flash-image-preview";

  try {
    const response = await fetch(
      `${baseUrl}/models/${model}:generateContent?key=${config.geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            topK: 32,
            topP: 1,
            maxOutputTokens: 4096,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini API request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts: Array<{
            inlineData?: { mimeType: string; data: string };
          }>;
        };
      }>;
    };

    if (
      !data.candidates ||
      data.candidates.length === 0 ||
      !data.candidates[0].content
    ) {
      throw new Error("No response from Gemini API");
    }

    // 从响应中提取图片数据
    const parts = data.candidates[0].content.parts;
    const imagePart = parts.find(
      (part: { inlineData?: { mimeType: string; data: string } }) =>
        part.inlineData?.mimeType?.startsWith("image/"),
    );

    if (!imagePart || !imagePart.inlineData) {
      throw new Error("No image data in Gemini response");
    }

    // 将 base64 转换为 ArrayBuffer
    const base64Data = imagePart.inlineData.data;
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return {
      imageData: bytes.buffer,
      prompt,
    };
  } catch (error) {
    console.error("Failed to generate mindmap image with Gemini:", error);
    throw new Error(
      `Gemini image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 构建思维导图生成 prompt
 *
 * @param mindmapMarkdown 思维导图的 Markdown 表示
 * @returns 生成的 prompt
 */
function buildMindmapPrompt(mindmapMarkdown: string): string {
  return `Create a beautiful, professional mindmap visualization based on the following structure:

${mindmapMarkdown}

Requirements:
- Use a clean, modern design with a radial layout
- Use different colors for different main branches
- Make the text readable and well-organized
- Center the root node prominently
- Use smooth connecting lines between nodes
- Ensure good spacing between nodes to avoid overlap
- Use a professional color palette`;
}
