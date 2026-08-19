import { parseSkillImport, type SkillInput } from "#/lib/skills";
import dailyBriefSource from "./daily-brief.md?raw";
import factCheckSource from "./fact-check.md?raw";
import { BUILTIN_SKILL_ID_PREFIX, isBuiltinId } from "./names";
import topicScanSource from "./topic-scan.md?raw";

// 名字集合与 id 工具住在 names.ts（不含 ?raw），客户端只该 import 那一个。
// 这里原样转出是为了不破坏既有的 "#/lib/builtin-skills" import 路径。
export {
  BUILTIN_SKILL_ID_PREFIX,
  BUILTIN_SKILL_NAMES,
  isBuiltinId,
} from "./names";

/**
 * 内置默认 skills：代码常量，不入库。用户第一次对它做写操作时才实体化成
 * assistant_skills 行（见 skills router 的 update）。同名用户行永远覆盖内置行。
 *
 * 正文用生产同一套 parseSkillImport 解析——这里不允许出现第二套 frontmatter 解析。
 */

/** 内置行在 UI 上显示 "Built-in" 徽章而非日期，这个值只是为了让 SSR/CSR 两次渲染一致 */
export const BUILTIN_TIMESTAMP = new Date(0);

export type BuiltinSkill = SkillInput;

/**
 * 解析失败只跳过该条并记日志：模块顶层 throw 会炸掉整个 Worker 冷启动，
 * 一条引导物料不值这个代价。守门交给 index.test.ts。
 */
function parseAll(sources: readonly string[]): readonly BuiltinSkill[] {
  const parsed: BuiltinSkill[] = [];
  for (const source of sources) {
    const result = parseSkillImport(source);
    if (!result.ok) {
      console.error(`builtin skill failed to parse: ${result.error}`);
      continue;
    }
    parsed.push(result.value);
  }
  return Object.freeze(parsed);
}

export const BUILTIN_SKILLS = parseAll([
  factCheckSource,
  dailyBriefSource,
  topicScanSource,
]);

export function builtinIdOf(name: string): string {
  return `${BUILTIN_SKILL_ID_PREFIX}${name}`;
}

export function findBuiltinSkill(name: string): BuiltinSkill | undefined {
  return BUILTIN_SKILLS.find((skill) => skill.name === name);
}

/** 虚拟 id → 内置定义；不是虚拟 id、或名字不存在，都返回 undefined */
export function findBuiltinById(id: string): BuiltinSkill | undefined {
  if (!isBuiltinId(id)) return undefined;
  return findBuiltinSkill(id.slice(BUILTIN_SKILL_ID_PREFIX.length));
}
