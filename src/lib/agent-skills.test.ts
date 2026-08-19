/**
 * agent 管线与 skills 的接触面：readSkill 工具（真 sqlite，越权/disabled 语义需要真 WHERE）
 * 与 buildAgentSystemPrompt 的 catalog 注入位置。跑在真 SQLite 上见 test/helpers/sqlite-d1。
 */
import { describe, expect, it } from "vitest";
import { assistantSkills, user } from "#/db/schema";
import { buildAgentSystemPrompt, buildAgentTools } from "#/lib/agent";
import { buildSkillsCatalogSection } from "#/lib/skills";
import { createTestDb } from "../../test/helpers/sqlite-d1";

type Db = ReturnType<typeof createTestDb>["db"];

/** minimal ToolExecutionOptions stub — only fields required by the type, same as discovery-tools.test.ts */
const toolOptions = { toolCallId: "test-call", messages: [] } as never;

function getExecute(tool: { execute?: unknown }) {
  const { execute } = tool;
  if (typeof execute !== "function") throw new Error("execute is not set");
  return execute as (input: unknown, opts: never) => Promise<unknown>;
}

async function seedUser(db: Db, id: string) {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    createdAt: now,
    updatedAt: now,
  });
}

describe("readSkill tool", () => {
  it("returns the expanded instructions for an enabled skill owned by the user", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");
    await db.insert(assistantSkills).values({
      userId: "user-1",
      name: "my-skill",
      description: "does a thing",
      body: "Do the thing with $ARGUMENT please.",
    });

    const tools = buildAgentTools({
      db,
      bucket: {} as never,
      userId: "user-1",
      locale: "en",
      isGuest: false,
    });

    const result = await getExecute(tools.readSkill)(
      { name: "my-skill", args: "x" },
      toolOptions,
    );
    expect(result).toEqual({
      name: "my-skill",
      instructions: "Do the thing with x please.",
    });
  });

  it("returns an error with the list of available (enabled) skill names when the name is not found", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");
    await db.insert(assistantSkills).values([
      {
        userId: "user-1",
        name: "enabled-skill",
        description: "d",
        body: "b",
      },
      {
        userId: "user-1",
        name: "disabled-skill",
        description: "d",
        body: "b",
        enabled: false,
      },
    ]);

    const tools = buildAgentTools({
      db,
      bucket: {} as never,
      userId: "user-1",
      locale: "en",
      isGuest: false,
    });

    const result = await getExecute(tools.readSkill)(
      { name: "does-not-exist" },
      toolOptions,
    );
    expect(result).toEqual({
      error: "skill not found",
      available: ["enabled-skill", "fact-check", "daily-brief", "topic-scan"],
    });
  });

  it("reports a disabled skill as disabled rather than falling through", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");
    await db.insert(assistantSkills).values({
      userId: "user-1",
      name: "disabled-skill",
      description: "d",
      body: "b",
      enabled: false,
    });

    const tools = buildAgentTools({
      db,
      bucket: {} as never,
      userId: "user-1",
      locale: "en",
      isGuest: false,
    });

    const result = await getExecute(tools.readSkill)(
      { name: "disabled-skill" },
      toolOptions,
    );
    expect(result).toEqual({ error: "skill is disabled" });
  });
});

describe("readSkill builtin fallback", () => {
  const deps = (db: Db) =>
    buildAgentTools({
      db,
      bucket: {} as never,
      userId: "user-1",
      locale: "en",
      isGuest: false,
    });

  it("没有同名用户行时读到内置正文", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");

    const result = (await getExecute(deps(db).readSkill)(
      { name: "fact-check" },
      toolOptions,
    )) as { name: string; instructions: string };
    expect(result.name).toBe("fact-check");
    expect(result.instructions).toContain("neutral verification pass");
  });

  it("同名用户行覆盖内置正文", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");
    await db.insert(assistantSkills).values({
      userId: "user-1",
      name: "fact-check",
      description: "mine",
      body: "My own version.",
    });

    const result = await getExecute(deps(db).readSkill)(
      { name: "fact-check" },
      toolOptions,
    );
    expect(result).toEqual({
      name: "fact-check",
      instructions: "My own version.",
    });
  });

  // 复活陷阱在 readSkill 侧的回归锁：关掉内置 = 一条 enabled=false 的同名用户行。
  // 若这里回落到内置，用户关掉的 skill 就复活了。
  it("disabled 的同名用户行不回落内置", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");
    await db.insert(assistantSkills).values({
      userId: "user-1",
      name: "fact-check",
      description: "d",
      body: "b",
      enabled: false,
    });

    const result = await getExecute(deps(db).readSkill)(
      { name: "fact-check" },
      toolOptions,
    );
    expect(result).toEqual({ error: "skill is disabled" });
  });
});

describe("buildAgentSystemPrompt skills catalog injection", () => {
  it("omits the skills section entirely when the catalog is empty", () => {
    const prompt = buildAgentSystemPrompt(null, true, "");
    expect(prompt).not.toContain("readSkill");
    expect(prompt).not.toContain("<agent_skill");
  });

  it("injects the catalog section before the fabrication-guard rule", () => {
    const catalog = buildSkillsCatalogSection(
      [{ name: "a", description: "b" }],
      false,
    );
    const prompt = buildAgentSystemPrompt(null, true, catalog);
    expect(prompt).toContain(
      JSON.stringify({
        skills: [{ name: "a", description: "b" }],
        truncated: false,
      }),
    );
    expect(prompt).toContain("call readSkill with its name");
    expect(prompt).toContain(
      'When a user message contains an <agent_skill name="X" /> tag',
    );

    const skillsIndex = prompt.indexOf("The user has saved reusable skills");
    const guardIndex = prompt.indexOf(
      "- If something cannot be found, say so plainly.",
    );
    expect(skillsIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(skillsIndex).toBeLessThan(guardIndex);
  });
});
