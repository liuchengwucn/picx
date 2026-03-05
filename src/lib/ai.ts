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
}

/**
 * 思维导图节点结构
 */
export interface MindmapNode {
  id: string;
  text: string;
  children?: MindmapNode[];
}

/**
 * 思维导图结构
 */
export interface MindmapStructure {
  root: MindmapNode;
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
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
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

    const data = await response.json();

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
 * 调用 OpenAI API 生成思维导图 JSON 结构
 *
 * @param paperText 论文文本内容
 * @param config AI 配置
 * @returns 思维导图结构
 * @throws 如果生成失败则抛出错误
 */
export async function generateMindmapStructure(
  paperText: string,
  config: AIConfig,
): Promise<MindmapStructure> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5-mini";

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an expert at creating structured mindmaps from academic papers. Generate a hierarchical JSON structure that represents the paper's key concepts, methodology, and findings. Return ONLY valid JSON without any markdown formatting or code blocks.",
          },
          {
            role: "user",
            content: `Create a mindmap structure for the following paper. Return a JSON object with this structure:
{
  "root": {
    "id": "root",
    "text": "Paper Title",
    "children": [
      {
        "id": "1",
        "text": "Main Topic 1",
        "children": [...]
      }
    ]
  }
}

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

    const data = await response.json();

    if (!data.choices || data.choices.length === 0) {
      throw new Error("No response from OpenAI API");
    }

    const content = data.choices[0].message?.content?.trim();

    if (!content) {
      throw new Error("Empty mindmap structure generated");
    }

    // 尝试解析 JSON，处理可能的 markdown 代码块
    let jsonContent = content;
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonContent = codeBlockMatch[1];
    }

    const mindmapStructure = JSON.parse(jsonContent) as MindmapStructure;

    // 验证结构
    if (!mindmapStructure.root || !mindmapStructure.root.id) {
      throw new Error("Invalid mindmap structure: missing root node");
    }

    return mindmapStructure;
  } catch (error) {
    console.error("Failed to generate mindmap structure:", error);
    throw new Error(
      `Mindmap structure generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 调用 Gemini API 生成思维导图图片
 *
 * @param mindmapStructure 思维导图结构
 * @param config AI 配置
 * @returns 图片的 ArrayBuffer 数据和用于生成的 prompt
 * @throws 如果生成失败则抛出错误
 */
export async function generateMindmapImage(
  mindmapStructure: MindmapStructure,
  config: AIConfig,
): Promise<{ imageData: ArrayBuffer; prompt: string }> {
  const baseUrl =
    config.geminiBaseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const model = config.geminiModel || "gemini-3.1-flash-image-preview";

  try {
    // 构建 prompt
    const prompt = buildMindmapPrompt(mindmapStructure);

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

    const data = await response.json();

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
    console.error("Failed to generate mindmap image:", error);
    throw new Error(
      `Mindmap image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * 构建思维导图生成 prompt
 *
 * @param structure 思维导图结构
 * @returns 生成的 prompt
 */
function buildMindmapPrompt(structure: MindmapStructure): string {
  const lines: string[] = [
    "Create a beautiful, professional mindmap visualization with the following structure:",
    "",
  ];

  function traverseNode(node: MindmapNode, indent = 0): void {
    const prefix = "  ".repeat(indent);
    lines.push(`${prefix}- ${node.text}`);
    if (node.children) {
      for (const child of node.children) {
        traverseNode(child, indent + 1);
      }
    }
  }

  traverseNode(structure.root);

  lines.push("");
  lines.push("Requirements:");
  lines.push("- Use a clean, modern design");
  lines.push("- Use different colors for different branches");
  lines.push("- Make the text readable and well-organized");
  lines.push("- Center the root node");
  lines.push("- Use connecting lines between nodes");

  return lines.join("\n");
}
