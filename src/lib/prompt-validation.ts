/**
 * 保留的提示词名称（不允许用户使用）
 */
const RESERVED_PROMPT_NAMES = ["system", "__system__", "default"];

/**
 * 验证提示词名称是否为保留名称
 */
export function isReservedPromptName(name: string): boolean {
  return RESERVED_PROMPT_NAMES.includes(name.toLowerCase());
}

/**
 * 验证 prompt 模板是否包含正确数量的 {contentText} 占位符
 */
export function validatePromptTemplate(template: string): {
  valid: boolean;
  error?: string;
} {
  const contentTextCount = (template.match(/\{contentText\}/g) || []).length;

  if (contentTextCount === 0) {
    return {
      valid: false,
      error: "whiteboard_prompt_validation_content_text_required",
    };
  }

  if (contentTextCount > 1) {
    return {
      valid: false,
      error: "whiteboard_prompt_validation_content_text_once",
    };
  }

  return { valid: true };
}

/**
 * 替换 prompt 模板中的占位符
 */
export function buildPromptFromTemplate(
  template: string,
  whiteboardInsights: string,
  contentText: string,
  language: "en" | "zh-cn" | "zh-tw" | "ja",
): string {
  const languageInstruction =
    language === "zh-cn"
      ? "请用简体中文生成白板图，包括所有文字、标注和说明。"
      : language === "zh-tw"
        ? "請用繁體中文生成白板圖，包括所有文字、標註和說明。"
        : language === "ja"
          ? "日本語でホワイトボード図を生成してください。すべてのテキスト、ラベル、説明を含めてください。"
          : "Generate the whiteboard in English, including all text, labels, and captions.";

  return template
    .replace(/\{whiteboardInsights\}/g, whiteboardInsights)
    .replace(/\{contentText\}/g, contentText)
    .replace(/\{languageInstruction\}/g, languageInstruction);
}

/**
 * 获取系统默认 prompt 模板（与 ai.ts 中的 buildWhiteboardPrompt 保持一致）
 */
export function getSystemDefaultPromptTemplate(): string {
  return `Transform this academic paper into a professor-style whiteboard image. Include diagrams, arrows, boxes, and short captions that explain the core ideas visually.

{languageInstruction}

Key insights to emphasize:
{whiteboardInsights}

Paper content:
{contentText}

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
