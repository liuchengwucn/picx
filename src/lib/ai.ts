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

import { extractFirstJsonObject } from "#/lib/json-extract";
import {
  normalizeCategorySlugs,
  PAPER_CATEGORY_SLUGS,
} from "#/lib/paper-categories";
import {
  buildPromptFromTemplate,
  getSystemDefaultPromptTemplate,
} from "#/lib/prompt-validation";

export { extractFirstJsonObject } from "#/lib/json-extract";

export interface PaperTailReviewInput {
  candidateTitle: string;
  pageNumber: number;
  totalPages: number;
  previousContext: string;
  candidateContext: string;
  nextContext: string;
}

export interface PaperTailReviewResult {
  cut: boolean;
  confidence: number;
}

/**
 * 调用 OpenAI API 生成论文总结
 *
 * @param paperText 论文文本内容
 * @param config AI 配置
 * @param language 生成语言 ('en' 为英文, 'zh-cn' 为简体中文, 'zh-tw' 为繁体中文, 'ja' 为日文)
 * @returns 论文总结文本（Markdown 格式）
 * @throws 如果生成失败则抛出错误
 */
export async function generateSummary(
  paperText: string,
  config: AIConfig,
  language: "en" | "zh-cn" | "zh-tw" | "ja" = "en",
): Promise<string> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";

  const languageInstruction =
    language === "zh-cn"
      ? "请用简体中文回答。"
      : language === "zh-tw"
        ? "請用繁體中文回答。"
        : language === "ja"
          ? "日本語で回答してください。"
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
- Put display equations on their own lines with opening and closing $$ on separate lines; do not use single-line $$ equation $$
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
 * 调用 OpenAI API 生成白板洞察
 *
 * @param paperText 论文文本内容
 * @param config AI 配置
 * @returns 白板的洞察内容（Markdown 格式）
 * @throws 如果生成失败则抛出错误
 */
export async function generateWhiteboardInsights(
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
      throw new Error("Empty whiteboard insights generated");
    }

    return content;
  } catch (error) {
    console.error("Failed to generate whiteboard insights:", error);
    throw new Error(
      `Whiteboard insights generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 生成白板图片
 * 支持通过 OpenRouter 或直接调用 Gemini API
 * 如果论文文本过长导致失败，会自动降级使用摘要重试
 *
 * @param whiteboardInsights 白板的洞察内容（Markdown 格式）
 * @param paperText 原始论文文本
 * @param config AI 配置
 * @param language 白板图语言 ('en' 为英文, 'zh-cn' 为简体中文, 'zh-tw' 为繁体中文, 'ja' 为日文)
 * @param summary 可选的论文摘要，当论文文本过长时使用
 * @param customPromptTemplate 可选的自定义 prompt 模板
 * @returns 图片的 ArrayBuffer 数据和用于生成的 prompt
 * @throws 如果生成失败则抛出错误
 */
export async function generateWhiteboardImage(
  whiteboardInsights: string,
  paperText: string,
  config: AIConfig,
  language: "en" | "zh-cn" | "zh-tw" | "ja" = "en",
  summary?: string,
  customPromptTemplate?: string,
): Promise<{ imageData: ArrayBuffer; prompt: string }> {
  // 检测是否使用 OpenRouter (通过 geminiBaseUrl 判断)
  const isOpenRouter = config.geminiBaseUrl?.includes("openrouter");

  // 获取 prompt 模板（自定义或默认）
  const promptTemplate =
    customPromptTemplate || getSystemDefaultPromptTemplate();

  // 先尝试使用完整论文文本
  try {
    const prompt = buildPromptFromTemplate(
      promptTemplate,
      whiteboardInsights,
      paperText,
      language,
    );

    if (isOpenRouter) {
      return await generateWhiteboardImageWithOpenRouter(prompt, config);
    }
    return await generateWhiteboardImageWithGemini(prompt, config);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 如果有摘要，不管什么错误都尝试使用摘要重试
    if (summary) {
      console.log(
        "First attempt failed, retrying with summary instead of full paper text",
      );
      console.log(`Original error: ${errorMessage}`);
      console.log(
        `Paper text length: ${paperText.length}, Summary length: ${summary.length}`,
      );
      const promptWithSummary = buildPromptFromTemplate(
        promptTemplate,
        whiteboardInsights,
        summary,
        language,
      );

      if (isOpenRouter) {
        return await generateWhiteboardImageWithOpenRouter(
          promptWithSummary,
          config,
        );
      }
      return await generateWhiteboardImageWithGemini(promptWithSummary, config);
    }

    // 没有摘要，直接抛出原始错误
    throw error;
  }
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
      error?: {
        message?: string;
        code?: number;
      };
    };

    // 记录完整响应以便调试
    console.log(
      "OpenRouter API response:",
      JSON.stringify(data).substring(0, 500),
    );

    // 检查是否有错误信息
    if (data.error) {
      throw new Error(
        `OpenRouter API error: ${data.error.message || "Unknown error"}`,
      );
    }

    if (!data.choices || data.choices.length === 0) {
      throw new Error("No response from OpenRouter API (empty choices array)");
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
    console.error(
      "Failed to generate whiteboard image with OpenRouter:",
      error,
    );
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
 * @param targetLanguage 目标语言 ('en' 为英文, 'zh-cn' 为简体中文, 'zh-tw' 为繁体中文, 'ja' 为日文)
 * @param config AI 配置
 * @returns 翻译后的摘要文本（Markdown 格式）
 * @throws 如果翻译失败则抛出错误
 */
export async function translateSummary(
  summaryText: string,
  targetLanguage: "en" | "zh-cn" | "zh-tw" | "ja",
  config: AIConfig,
): Promise<string> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";

  const languageInstruction =
    targetLanguage === "zh-cn"
      ? "请将以下学术论文摘要翻译成简体中文。"
      : targetLanguage === "zh-tw"
        ? "請將以下學術論文摘要翻譯成繁體中文。"
        : targetLanguage === "ja"
          ? "以下の学術論文の要約を日本語に翻訳してください。"
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
 * 语言代码 -> 人类可读语言名 (用于 prompt)
 */
function languageDisplayName(
  language: "en" | "zh-cn" | "zh-tw" | "ja",
): string {
  switch (language) {
    case "zh-cn":
      return "Simplified Chinese (简体中文)";
    case "zh-tw":
      return "Traditional Chinese (繁體中文)";
    case "ja":
      return "Japanese (日本語)";
    default:
      return "English";
  }
}

/**
 * 调用 OpenAI API 生成一句话核心结论 (TL;DR)
 *
 * 用于 gallery 卡片: 把已生成的摘要蒸馏成一句话, 让用户一眼抓住重点。
 * 输入用已蒸馏的 summary (而非全文) 以节约 token。
 *
 * @param summaryOrText 论文摘要 (Markdown) 或正文
 * @param config AI 配置
 * @param language 输出语言
 * @returns 一句话核心结论 (纯文本, 无 Markdown/LaTeX)
 * @throws 如果生成失败则抛出错误
 */
export async function generateTldr(
  summaryOrText: string,
  config: AIConfig,
  language: "en" | "zh-cn" | "zh-tw" | "ja" = "en",
): Promise<string> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";

  const systemPrompt = `You are an expert at distilling academic papers into a single punchy takeaway.

Given a paper's content, output ONE sentence (maximum 30 words) that captures its single most important contribution or finding — the kind of one-liner a researcher would use to decide whether to read further.

Respond in ${languageDisplayName(language)}.

STRICT OUTPUT RULES:
- Output ONLY the sentence, nothing else (no preamble, no quotes, no label).
- Plain text only: NO Markdown, NO LaTeX, NO math symbols, NO bullet points, NO citations.
- Lead with the result/contribution, not background.
- Keep technical terms and named methods, but stay concise and readable.`;

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
            content: summaryOrText,
          },
        ],
        temperature: 0.5,
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
      choices?: Array<{ message?: { content?: string } }>;
    };

    const tldr = data.choices?.[0]?.message?.content?.trim();

    if (!tldr) {
      throw new Error("Empty tldr generated");
    }

    return tldr;
  } catch (error) {
    console.error("Failed to generate tldr:", error);
    throw new Error(
      `Tldr generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 调用 OpenAI API 翻译一句话核心结论 (TL;DR)
 *
 * 输入很短, 是一次轻量调用; 不复用面向长 Markdown 的 translateSummary。
 *
 * @param tldrText 原始 TL;DR (纯文本)
 * @param targetLanguage 目标语言
 * @param config AI 配置
 * @returns 翻译后的 TL;DR (纯文本)
 * @throws 如果翻译失败则抛出错误
 */
export async function translateTldr(
  tldrText: string,
  targetLanguage: "en" | "zh-cn" | "zh-tw" | "ja",
  config: AIConfig,
): Promise<string> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";

  const systemPrompt = `You are an expert academic translator. Translate the given one-sentence research takeaway into ${languageDisplayName(targetLanguage)}.

STRICT OUTPUT RULES:
- Output ONLY the translated sentence, nothing else.
- Plain text only: NO Markdown, NO LaTeX, NO added quotes.
- Keep technical terms and named methods accurate.
- Preserve the concise, single-sentence form.`;

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
            content: tldrText,
          },
        ],
        temperature: 0.3,
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
      choices?: Array<{ message?: { content?: string } }>;
    };

    const translated = data.choices?.[0]?.message?.content?.trim();

    if (!translated) {
      throw new Error("Empty tldr translation generated");
    }

    return translated;
  } catch (error) {
    console.error("Failed to translate tldr:", error);
    throw new Error(
      `Tldr translation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
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
      return `${title.substring(0, 252)}...`;
    }

    return title;
  } catch (error) {
    console.error("Failed to extract paper title:", error);
    throw new Error(
      `Title extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

function parsePaperTailReviewResult(content: string): PaperTailReviewResult {
  const jsonText = extractFirstJsonObject(content);

  if (!jsonText) {
    throw new Error("No JSON object found in tail review response");
  }

  const parsed = JSON.parse(jsonText) as Partial<PaperTailReviewResult>;

  return {
    cut: Boolean(parsed.cut),
    confidence: Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, Number(parsed.confidence)))
      : 0,
  };
}

export async function reviewPaperTailCandidate(
  input: PaperTailReviewInput,
  config: AIConfig,
): Promise<PaperTailReviewResult> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";

  const systemPrompt = `You review academic paper text and decide whether a candidate heading marks the end of the paper's main body.

Return only a JSON object with this exact shape:
{
  "cut": boolean,
  "confidence": number
}

Rules:
- Cut only when the candidate clearly starts non-body tail content.
- Tail content includes references, bibliography, appendix, supplementary material, acknowledgments, author contributions, and similar back matter.
- The candidate may be in English, Chinese, or Japanese.
- Do not cut when the candidate text is only mentioned inside normal body prose.
- Do not reject a cutoff just because it appears early in the PDF.
- If uncertain, return {"cut": false, "confidence": 0}.`;

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
            content: JSON.stringify(input),
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
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
      throw new Error("Empty paper tail review response");
    }

    return parsePaperTailReviewResult(content);
  } catch (error) {
    console.error("Failed to review paper tail candidate:", error);
    throw new Error(
      `Paper tail review failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/** 把 tag 规范化为小写连字符短串。 */
function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 纯函数:从 LLM 文本里解析出 { categories, tags }。
 * - 容忍代码围栏/前后散文(复用 extractFirstJsonObject)
 * - 只保留合法分类 slug,去重,最多 3 个;无合法则 ["other"]
 * - tag 规范化为小写连字符,去重,最多 6 个
 * - 任何异常都安全兜底 { categories: ["other"], tags: [] }
 */
export function parseClassification(content: string): {
  categories: string[];
  tags: string[];
} {
  const fallback = { categories: ["other"], tags: [] as string[] };
  try {
    const jsonStr = extractFirstJsonObject(content);
    if (!jsonStr) return fallback;
    const parsed = JSON.parse(jsonStr) as {
      categories?: unknown;
      tags?: unknown;
    };
    const rawCats = Array.isArray(parsed.categories)
      ? parsed.categories.filter((x): x is string => typeof x === "string")
      : [];
    const cats = normalizeCategorySlugs(rawCats).slice(0, 3);
    const rawTags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((x): x is string => typeof x === "string")
      : [];
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const t of rawTags) {
      const n = normalizeTag(t);
      if (n && !seen.has(n)) {
        seen.add(n);
        tags.push(n);
      }
      if (tags.length >= 6) break;
    }
    return {
      categories: cats.length > 0 ? cats : ["other"],
      tags,
    };
  } catch {
    return fallback;
  }
}

/**
 * 调用 LLM 给论文分类并产出自由 tag。语言无关,用英文摘要/正文即可。
 * 失败时**抛错**(由调用方 withRetry 重试,重试耗尽再兜底 ["other"])。
 * 不在此吞掉异常:否则一次瞬时抖动/截断就会把论文永久钉成 ["other"]。
 */
export async function classifyPaper(
  text: string,
  config: AIConfig,
): Promise<{ categories: string[]; tags: string[] }> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";

  const systemPrompt = `You are an expert at classifying AI/ML research papers.

Pick 1-3 PRIMARY categories from this EXACT fixed list (use the slug verbatim):
${PAPER_CATEGORY_SLUGS.join(", ")}

Then produce 3-5 free-form fine-grained TAGS (lowercase, hyphenated, e.g. "image-restoration").

Rules:
- Categories MUST be slugs from the list above. If nothing fits, use ["other"].
- Prefer the most specific fitting categories; do not over-assign.
- Output ONLY a JSON object, no prose, no code fences:
{"categories":["..."],"tags":["..."]}`;

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
        { role: "system", content: systemPrompt },
        { role: "user", content: text.slice(0, 3500) },
      ],
      temperature: 0.2,
      // 200 太紧:分类 + 3-5 个 tag 的 JSON 偶尔会被截断成无法解析,
      // 进而落到 ["other"] 兜底。留足余量避免截断。
      max_tokens: 400,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Classify API failed: ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const result = parseClassification(content);
  // parseClassification 永不抛错:解析失败/截断/无合法分类都返回
  // { categories:["other"], tags:[] }。而正常分类必带 3-5 个 tag,
  // 所以「other + 空 tags」就是调用失败的特征 —— 抛错让上层 withRetry
  // 重试,而非把瞬时失败固化成 ["other"]。
  if (
    result.tags.length === 0 &&
    result.categories.length === 1 &&
    result.categories[0] === "other"
  ) {
    throw new Error("Classification produced no usable result (empty/garbled)");
  }
  return result;
}
