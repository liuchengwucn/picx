/**
 * 内置 skill 的名字集合与虚拟 id 工具。刻意与 index.ts 分家：index.ts 会 ?raw 引入
 * 三份 SKILL.md，任何客户端组件 import 它都会把三份正文（约 7KB）打进 bundle，
 * 而前端只需要名字和一个前缀判断。
 *
 * 名字是手写常量，会与三份 .md 的 frontmatter 漂移——index.test.ts 里有一条断言
 * 把两者钉死，改名字时那条会变红。
 */

export const BUILTIN_SKILL_ID_PREFIX = "builtin:";

export const BUILTIN_SKILL_NAMES: ReadonlySet<string> = new Set([
  "fact-check",
  "daily-brief",
  "topic-scan",
]);

export function isBuiltinId(id: string): boolean {
  return id.startsWith(BUILTIN_SKILL_ID_PREFIX);
}
