import { describe, expect, it } from "vitest";
import {
  buildSkillDirectiveText,
  buildSkillsCatalogSection,
  expandSkillBody,
  parseSkillDirective,
  parseSkillImport,
  SKILL_LIMITS,
} from "#/lib/skills";

describe("parseSkillImport", () => {
  it("解析标准 SKILL.md（含 BOM、CRLF、多余 frontmatter 字段）", () => {
    const source =
      "﻿" +
      `---\r\nname: weekly-scan\r\ndescription: Scan new papers weekly\r\nextra: ignored\r\n---\r\nDo the thing.\r\nStep 2.`;
    const result = parseSkillImport(source);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "weekly-scan",
        description: "Scan new papers weekly",
        body: "Do the thing.\nStep 2.",
      },
    });
  });
  it("缺 frontmatter → no_frontmatter", () => {
    expect(parseSkillImport("just text")).toEqual({
      ok: false,
      error: "no_frontmatter",
    });
  });
  it("frontmatter 未闭合 → unclosed_frontmatter", () => {
    expect(parseSkillImport("---\nname: a")).toEqual({
      ok: false,
      error: "unclosed_frontmatter",
    });
  });
  it("非法 YAML → invalid_yaml", () => {
    expect(parseSkillImport("---\nname: [unclosed\n---\nbody")).toEqual({
      ok: false,
      error: "invalid_yaml",
    });
  });
  it("name 非 slug / 空 body → invalid_fields", () => {
    expect(
      parseSkillImport("---\nname: Bad Name\ndescription: d\n---\nbody"),
    ).toEqual({ ok: false, error: "invalid_fields" });
    expect(parseSkillImport("---\nname: ok\ndescription: d\n---\n\n")).toEqual({
      ok: false,
      error: "invalid_fields",
    });
  });
});

describe("expandSkillBody", () => {
  it("含占位符逐处替换，且不吞 $ARGUMENTS 这类更长的词", () => {
    expect(expandSkillBody("run $ARGUMENT twice: $ARGUMENT", "x")).toBe(
      "run x twice: x",
    );
    expect(expandSkillBody("keep $ARGUMENTS", "x")).toBe(
      "keep $ARGUMENTS\n\nARGUMENT: x",
    );
  });
  it("args 含替换模式串 $& 时原样注入", () => {
    expect(expandSkillBody("do $ARGUMENT", "$&")).toBe("do $&");
  });
  it("无占位符 + 空 args 原样返回", () => {
    expect(expandSkillBody("plain", "")).toBe("plain");
  });
});

describe("skill directive", () => {
  it("build/parse 互逆（有参与无参）", () => {
    expect(
      parseSkillDirective(buildSkillDirectiveText("my-skill", " hi ")),
    ).toEqual({ name: "my-skill", args: "hi" });
    expect(
      parseSkillDirective(buildSkillDirectiveText("my-skill", "")),
    ).toEqual({ name: "my-skill", args: "" });
  });
  it("普通文本 / 中途出现的 tag 不误判", () => {
    expect(parseSkillDirective("hello")).toBeNull();
    expect(parseSkillDirective('say <agent_skill name="x" />')).toBeNull();
  });
});

describe("buildSkillsCatalogSection", () => {
  it("空列表返回空串", () => {
    expect(buildSkillsCatalogSection([], false)).toBe("");
  });
  it("超长 description 截断到 400，truncated 透传", () => {
    const section = buildSkillsCatalogSection(
      [{ name: "a", description: "x".repeat(500) }],
      true,
    );
    const json = JSON.parse(section.split("\n")[1] ?? "") as {
      skills: { description: string }[];
      truncated: boolean;
    };
    expect(json.skills[0]?.description).toHaveLength(
      SKILL_LIMITS.catalogDescriptionMax,
    );
    expect(json.truncated).toBe(true);
  });
});
