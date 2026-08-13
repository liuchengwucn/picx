import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * 助手 skills 的共享常量与纯函数（前后端同构，勿引入服务端依赖）。
 * catalog 上限数值参考 cloudflare-os 的 AGENT_CATALOG_* 约定（25 条 / 400 字符）。
 */
export const SKILL_LIMITS = {
  maxPerUser: 50,
  nameMax: 64,
  descriptionMax: 1024,
  bodyMax: 65_536,
  catalogMaxEntries: 25,
  catalogDescriptionMax: 400,
} as const;

export const skillNameSchema = z
  .string()
  .min(1)
  .max(SKILL_LIMITS.nameMax)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "lowercase letters, numbers, and single hyphens only",
  );

/** create/update 的字段校验，tRPC 与管理页表单共用同一份（防前后端漂移） */
export const skillInputSchema = z.object({
  name: skillNameSchema,
  description: z.string().trim().min(1).max(SKILL_LIMITS.descriptionMax),
  body: z.string().min(1).max(SKILL_LIMITS.bodyMax),
});
export type SkillInput = z.infer<typeof skillInputSchema>;

export type SkillImportError =
  | "no_frontmatter"
  | "unclosed_frontmatter"
  | "invalid_yaml"
  | "invalid_fields";

export type SkillImportResult =
  | { ok: true; value: SkillInput }
  | { ok: false; error: SkillImportError };

function isFrontmatterFence(line: string): boolean {
  return line.startsWith("---") && line.slice(3).trim() === "";
}

/**
 * 解析粘贴的 SKILL.md（Claude Code / cloudflare-os 同格式）：
 * frontmatter 只取 name/description（多余字段忽略），fence 之后的内容为 body。
 * 容忍 BOM 与 CRLF。空 body 归入 invalid_fields。
 */
export function parseSkillImport(source: string): SkillImportResult {
  const text = source.startsWith("﻿") ? source.slice(1) : source;
  const lines = text.split(/\r?\n/);
  if (!isFrontmatterFence(lines[0] ?? "")) {
    return { ok: false, error: "no_frontmatter" };
  }
  const end = lines.findIndex(
    (line, index) => index > 0 && isFrontmatterFence(line),
  );
  if (end < 0) return { ok: false, error: "unclosed_frontmatter" };
  let data: unknown;
  try {
    data = parseYaml(lines.slice(1, end).join("\n"));
  } catch {
    return { ok: false, error: "invalid_yaml" };
  }
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "invalid_fields" };
  }
  const { name, description } = data as Record<string, unknown>;
  const parsed = skillInputSchema.safeParse({
    name,
    description,
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
  });
  if (!parsed.success) return { ok: false, error: "invalid_fields" };
  return { ok: true, value: parsed.data };
}

/**
 * $ARGUMENT 展开（正则同 cloudflare-os：后面不跟字母/数字/下划线/`[` 才算占位符）。
 * 正文含占位符 → 逐处替换；不含且 args 非空 → 追加 ARGUMENT 行。
 * replace 用函数形式：args 里的 `$&` 等替换模式串不能被解释。
 */
export function expandSkillBody(body: string, args: string): string {
  const pattern = /\$ARGUMENT(?![A-Za-z0-9_[])/g;
  const usesArgument = pattern.test(body);
  pattern.lastIndex = 0;
  const expanded = body.replace(pattern, () => args);
  return !usesArgument && args ? `${expanded}\n\nARGUMENT: ${args}` : expanded;
}

/** slash 指令消息文本。name 是严格 slug，无转义问题 */
export function buildSkillDirectiveText(name: string, args: string): string {
  const tag = `<agent_skill name="${name}" />`;
  const trimmed = args.trim();
  return trimmed ? `${tag}\nARGUMENT: ${trimmed}` : tag;
}

const SKILL_DIRECTIVE_RE =
  /^<agent_skill name="([a-z0-9]+(?:-[a-z0-9]+)*)" \/>(?:\nARGUMENT: ([\s\S]+))?$/;

/** 识别 slash 指令消息（前端徽章渲染用）；非指令返回 null */
export function parseSkillDirective(
  text: string,
): { name: string; args: string } | null {
  const match = SKILL_DIRECTIVE_RE.exec(text);
  if (!match) return null;
  return { name: match[1] ?? "", args: match[2] ?? "" };
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
}

/**
 * 系统提示的 skills 目录节。entries 为空返回空串（完全不注入，零 token）。
 * description 超 400 字符截断；truncated 告知模型列表不全。
 */
export function buildSkillsCatalogSection(
  entries: SkillCatalogEntry[],
  truncated: boolean,
): string {
  if (entries.length === 0) return "";
  const catalog = {
    skills: entries.map((entry) => ({
      name: entry.name,
      description:
        entry.description.length > SKILL_LIMITS.catalogDescriptionMax
          ? `${entry.description.slice(0, SKILL_LIMITS.catalogDescriptionMax - 1)}…`
          : entry.description,
    })),
    truncated,
  };
  return [
    "The user has saved reusable skills (instructions for recurring tasks):",
    JSON.stringify(catalog),
    "- When a task matches a skill's description, call readSkill with its name to load the full instructions, then follow them.",
    '- When a user message contains an <agent_skill name="X" /> tag, you MUST call readSkill for that name first (pass the ARGUMENT text via args if present), then follow the returned instructions exactly.',
  ].join("\n");
}
