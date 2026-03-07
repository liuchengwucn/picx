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
  const model = config.openaiModel || "gpt-5.2-instant";

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

CRITICAL - Preserve Mathematical Content:
- ALWAYS preserve key mathematical formulas, equations, and expressions from the paper
- Use LaTeX notation: $inline$ for inline math, $$display$$ for display equations
- Include formula numbers and references when present in the original paper
- Preserve mathematical notation exactly as it appears (variables, operators, subscripts, superscripts)
- For complex equations, use display mode ($$...$$) with proper formatting
- Include definitions of key variables and parameters

CRITICAL - Preserve Important Tables:
- ALWAYS include important tables that contain key results, comparisons, or experimental data
- Use Markdown table syntax with proper alignment
- Preserve column headers and row labels exactly
- Include table captions and numbers when present
- For large tables, include the most important rows/columns
- Highlight significant values or patterns in the table caption

Guidelines:
- Use proper Markdown formatting (headers, lists, bold, italic)
- Use code blocks with syntax highlighting when showing code
- Use blockquotes (>) for important quotes or definitions
- Be comprehensive but clear and well-organized
- Prioritize preserving quantitative results, formulas, and data tables over prose descriptions`;

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
 * 调用 OpenAI API 生成白板 Markdown 结构
 *
 * @param paperText 论文文本内容
 * @param config AI 配置
 * @returns 白板的 Markdown 表示
 * @throws 如果生成失败则抛出错误
 */
export async function generateWhiteboardStructure(
  paperText: string,
  config: AIConfig,
): Promise<string> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";

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
              "You are an expert at analyzing academic papers and identifying key insights. Extract the most important concepts, findings, and relationships from the paper. Focus on what matters most - the core insights, breakthrough ideas, and critical connections between concepts.",
          },
          {
            role: "user",
            content: `Analyze the following paper and identify the key insights that should be emphasized on a whiteboard.

Think about:
- What are the core breakthrough ideas or novel contributions?
- What are the most important concepts and their relationships?
- What key formulas, equations, or results are critical to understanding?
- What insights would a professor emphasize when explaining this on a whiteboard?

Organize your analysis using Markdown lists:
# Paper Title
- Core Insight 1
  - Supporting Point 1.1
  - Supporting Point 1.2
- Core Insight 2
  - Supporting Point 2.1
    - Detail 2.1.1

Guidelines:
- Focus on insights and understanding, not visual design
- Organize by: Background, Methodology, Key Findings, Contributions, Limitations
- Keep text concise (max 5-7 words per item)
- Use 2-4 main insights, each with 2-4 supporting points
- Maximum 3 levels of depth
- Emphasize what's novel and important

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
      throw new Error("Empty whiteboard structure generated");
    }

    return content;
  } catch (error) {
    console.error("Failed to generate whiteboard structure:", error);
    throw new Error(
      `Whiteboard structure generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 生成白板图片
 * 支持通过 OpenRouter 或直接调用 Gemini API
 *
 * @param whiteboardMarkdown 白板的 Markdown 表示
 * @param paperText 原始论文文本
 * @param config AI 配置
 * @returns 图片的 ArrayBuffer 数据和用于生成的 prompt
 * @throws 如果生成失败则抛出错误
 */
export async function generateWhiteboardImage(
  whiteboardMarkdown: string,
  paperText: string,
  config: AIConfig,
): Promise<{ imageData: ArrayBuffer; prompt: string }> {
  const prompt = buildWhiteboardPrompt(whiteboardMarkdown, paperText);

  // 检测是否使用 OpenRouter (通过 geminiBaseUrl 判断)
  const isOpenRouter = config.geminiBaseUrl?.includes("openrouter");

  if (isOpenRouter) {
    // 使用 OpenRouter API (OpenAI 兼容格式)
    return await generateWhiteboardImageWithOpenRouter(prompt, config);
  }

  // 使用原生 Gemini API
  return await generateWhiteboardImageWithGemini(prompt, config);
}

/**
 * 使用 OpenRouter API 生成白板图片
 * OpenRouter 支持通过 chat completions API 调用 Gemini 图像生成模型
 */
async function generateWhiteboardImageWithOpenRouter(
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
    console.error("Failed to generate whiteboard image with OpenRouter:", error);
    throw new Error(
      `OpenRouter image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 使用原生 Gemini API 生成白板图片
 */
async function generateWhiteboardImageWithGemini(
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
    console.error("Failed to generate whiteboard image with Gemini:", error);
    throw new Error(
      `Gemini image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 翻译摘要文本
 *
 * @param summaryText 原始摘要文本（Markdown 格式）
 * @param targetLanguage 目标语言 ('en' 为英文, 'zh' 为中文)
 * @param config AI 配置
 * @returns 翻译后的摘要文本（Markdown 格式）
 * @throws 如果翻译失败则抛出错误
 */
export async function translateSummary(
  summaryText: string,
  targetLanguage: "en" | "zh",
  config: AIConfig,
): Promise<string> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";

  const languageInstruction =
    targetLanguage === "zh"
      ? "请将以下学术论文摘要翻译成中文。"
      : "Please translate the following academic paper summary into English.";

  const systemPrompt = `You are an expert translator specializing in academic papers. Translate the given summary while maintaining its structure and formatting.

${languageInstruction}

CRITICAL - Preserve Mathematical Content:
- ALWAYS preserve ALL mathematical formulas, equations, and expressions EXACTLY as they appear
- Keep LaTeX notation unchanged: $inline$ for inline math, $$display$$ for display equations
- Do NOT translate or modify any mathematical symbols, variables, operators, subscripts, superscripts
- Preserve formula numbers and references exactly as they appear
- Mathematical content should remain in its original form - only translate the surrounding text

CRITICAL - Preserve Tables:
- ALWAYS preserve ALL tables EXACTLY as they appear
- Keep Markdown table syntax unchanged
- Only translate table captions and text content within cells
- Preserve column headers, row labels, and numerical values exactly
- Maintain table alignment and structure

CRITICAL - Preserve Markdown Formatting:
- Keep all Markdown syntax (headers ##, lists -, bold **, italic *, code blocks \`\`\`, blockquotes >)
- Preserve code blocks and their syntax highlighting markers
- Maintain the document structure and hierarchy

Guidelines:
- Translate only the natural language text
- Maintain academic tone and terminology
- Keep technical terms accurate
- Preserve all formatting, formulas, tables, and code blocks exactly`;

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
            content: summaryText,
          },
        ],
        temperature: 0.3, // 较低的温度以保持翻译准确性
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

    const translatedText = data.choices[0].message?.content?.trim();

    if (!translatedText) {
      throw new Error("Empty translation generated");
    }

    return translatedText;
  } catch (error) {
    console.error("Failed to translate summary:", error);
    throw new Error(
      `Translation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 从论文文本中提取标题
 *
 * @param paperText 论文文本内容（前几页）
 * @param config AI 配置
 * @returns 提取的论文标题
 * @throws 如果提取失败则抛出错误
 */
export async function extractPaperTitle(
  paperText: string,
  config: AIConfig,
): Promise<string> {
  // 输入验证
  if (!paperText || paperText.trim().length === 0) {
    throw new Error("Paper text is empty or invalid");
  }

  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";

  const systemPrompt = `You are an expert at extracting paper titles from academic papers.
Extract the main title of the paper from the given text.
Return ONLY the title text, without any additional explanation or formatting.
If there is a subtitle, include it separated by a colon.
The title should be clean and properly formatted.
If you cannot find a clear title, return "Untitled Paper".`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    };

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
            content: `Extract the paper title from the following text:\n\n${paperText}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 200,
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

    const title = data.choices[0].message?.content?.trim();

    if (!title || title.length === 0) {
      throw new Error("Empty title extracted from LLM response");
    }

    // 限制标题长度
    if (title.length > 255) {
      return title.substring(0, 252) + "...";
    }

    return title;
  } catch (error) {
    console.error("Failed to extract paper title:", error);
    throw new Error(
      `Title extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 构建白板生成 prompt
 *
 * @param whiteboardMarkdown 白板的 Markdown 表示
 * @param paperText 原始论文文本
 * @returns 生成的 prompt
 */
function buildWhiteboardPrompt(whiteboardMarkdown: string, paperText: string): string {
  return `Transform this academic paper into a professor-style whiteboard image. Include diagrams, arrows, boxes, and short captions that explain the core ideas visually.

Key insights to emphasize:
${whiteboardMarkdown}

Original paper content:
${paperText}

Requirements:
- Create a hand-drawn whiteboard aesthetic with a clean, academic style
- Use boxes and circles to highlight key concepts from the insights above
- Draw arrows to show relationships and flow between ideas
- Include key formulas and equations prominently (extract from paper content)
- Use different sections or colors to organize main topics
- Make the text readable and well-organized
- Ensure good spacing to avoid clutter
- Use a professional, academic color palette (black, blue, red for emphasis)
- Mimic the style of a university professor explaining concepts on a whiteboard
- Focus on visualizing the insights and their connections, not just listing information`;
}
