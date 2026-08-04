/**
 * 从可能带围栏/散文的 LLM 文本中提取第一个 JSON 对象。
 *
 * - 优先尝试整体 JSON.parse(text.trim())：若文本本身就是干净的 JSON 对象，直接返回。
 * - 否则从第一个 `{` 开始做括号深度扫描，且该扫描是字符串感知的（跟踪是否处于
 *   字符串内部及反斜杠转义），避免字符串值里出现的 `}` 提前截断对象。
 * - 括号不平衡（截断/不完整响应）时返回 null。
 */
export function extractFirstJsonObject(text: string): string | null {
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return trimmed;
    }
  } catch {
    // 不是干净的 JSON，落入下面的扫描逻辑
  }

  const start = trimmed.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, i + 1);
      }
    }
  }

  return null;
}
