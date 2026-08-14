import { describe, expect, it } from "vitest";
import { formatSkillMarkdown, parseSkillImport } from "./skills";

describe("formatSkillMarkdown", () => {
  it("产出的文本能被 parseSkillImport 原样读回", () => {
    const input = {
      name: "paper-digest",
      description: "把论文压成三段式摘要",
      body: "# 步骤\n\n1. 读完整篇\n2. 输出三段",
    };

    const result = parseSkillImport(formatSkillMarkdown(input));

    expect(result).toEqual({ ok: true, value: input });
  });

  it("description 里的冒号、井号、引号、换行都能安全往返", () => {
    const input = {
      name: "tricky",
      description: '注意: 这里有 # 号、"引号"，还有\n换行',
      body: "正文",
    };

    const result = parseSkillImport(formatSkillMarkdown(input));

    expect(result).toEqual({ ok: true, value: input });
  });

  it("正文里的 --- 分隔线不会被当成 frontmatter 结束", () => {
    const input = {
      name: "with-rule",
      description: "正文里有水平线",
      body: "上半段\n\n---\n\n下半段",
    };

    const result = parseSkillImport(formatSkillMarkdown(input));

    expect(result).toEqual({ ok: true, value: input });
  });

  it("description 恰好是 YAML 可能误判成非字符串标量的文本也能安全往返", () => {
    for (const description of ["true", "123", "null", "- a", "yes", "~"]) {
      const input = { name: "edge-case", description, body: "正文" };

      const result = parseSkillImport(formatSkillMarkdown(input));

      expect(result).toEqual({ ok: true, value: input });
    }
  });

  it("未 trim 的表单原始值会被 trim 到期望值，且再次往返幂等", () => {
    // SkillInput 同时是编辑器表单状态类型，用户输入未必已 trim；
    // formatSkillMarkdown 必须自己 trim，不能指望调用方或 parseSkillImport 兜底。
    const raw = {
      name: "edge-case",
      description: "  spaced  ",
      body: "line1\nline2\n",
    };
    const trimmed = {
      name: "edge-case",
      description: "spaced",
      body: "line1\nline2",
    };

    const firstPass = parseSkillImport(formatSkillMarkdown(raw));
    expect(firstPass).toEqual({ ok: true, value: trimmed });

    // 幂等：把第一轮的输出再走一遍 format→parse，结果不再变化。
    if (firstPass.ok) {
      const secondPass = parseSkillImport(formatSkillMarkdown(firstPass.value));
      expect(secondPass).toEqual({ ok: true, value: trimmed });
    }
  });
});
