/**
 * 内置 skill 的守门测试。index.ts 解析失败时是静默跳过（不炸冷启动），
 * 所以文案写坏必须在这里变红，否则线上表现为 catalog 里凭空少一条。
 */
import { describe, expect, it } from "vitest";
import { skillNameSchema, SKILL_LIMITS } from "#/lib/skills";
import { BUILTIN_SKILLS, builtinIdOf, findBuiltinById, isBuiltinId } from "./index";

describe("builtin skills", () => {
  it("三条全部解析成功", () => {
    expect(BUILTIN_SKILLS.map((skill) => skill.name)).toEqual([
      "fact-check",
      "daily-brief",
      "topic-scan",
    ]);
  });

  it.each(["fact-check", "daily-brief", "topic-scan"])("%s 的字段合法", (name) => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === name);
    expect(skill).toBeDefined();
    if (!skill) return;
    expect(skillNameSchema.safeParse(skill.name).success).toBe(true);
    // 超过 catalogDescriptionMax 会在系统提示里被截断加 "…"，模型看到的是半句话
    expect(skill.description.length).toBeLessThanOrEqual(
      SKILL_LIMITS.catalogDescriptionMax,
    );
    expect(skill.body.length).toBeLessThanOrEqual(SKILL_LIMITS.bodyMax);
    expect(skill.body.trim().length).toBeGreaterThan(0);
  });

  it("虚拟 id 往返", () => {
    expect(isBuiltinId(builtinIdOf("fact-check"))).toBe(true);
    expect(isBuiltinId("0a1b2c3d-uuid")).toBe(false);
    expect(findBuiltinById(builtinIdOf("fact-check"))?.name).toBe("fact-check");
    expect(findBuiltinById(builtinIdOf("nope"))).toBeUndefined();
    expect(findBuiltinById("0a1b2c3d-uuid")).toBeUndefined();
  });
});
