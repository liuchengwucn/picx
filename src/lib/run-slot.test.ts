import { describe, expect, it } from "vitest";
import { RunSlot, type SlotRun } from "#/lib/run-slot";

interface TestRun extends SlotRun {
  aborted: boolean;
  finish(): void;
}

/**
 * 手动 resolve 的 finished，用来把 drain 窗口（await 旧轮 finished 期间）
 * 摊开验证交错。finishOnAbort 模拟真实 ChatRunner 行为：abort 触发流中断，
 * 生成循环随即结束、finished resolve。
 */
function makeRun(opts: { finishOnAbort?: boolean } = {}): TestRun {
  let resolve!: () => void;
  const finished = new Promise<void>((r) => {
    resolve = r;
  });
  let done = false;
  const run: TestRun = {
    aborted: false,
    get done() {
      return done;
    },
    finished,
    abort() {
      run.aborted = true;
      if (opts.finishOnAbort) queueMicrotask(() => run.finish());
    },
    finish() {
      done = true;
      resolve();
    },
  };
  return run;
}

describe("RunSlot", () => {
  it("occupies an empty slot immediately without aborting anything", async () => {
    const slot = new RunSlot<TestRun>();
    const r0 = makeRun();
    const returned = await slot.replace(() => r0);
    expect(returned).toBe(r0);
    expect(slot.current).toBe(r0);
    expect(r0.aborted).toBe(false);
  });

  it("does not abort an already finished run", async () => {
    const slot = new RunSlot<TestRun>();
    const r0 = makeRun();
    await slot.replace(() => r0);
    r0.finish();
    const r1 = makeRun();
    await slot.replace(() => r1);
    expect(r0.aborted).toBe(false);
    expect(slot.current).toBe(r1);
  });

  it("aborts the live run and waits for finished before creating the new one", async () => {
    const slot = new RunSlot<TestRun>();
    const r0 = makeRun();
    await slot.replace(() => r0);
    let created = false;
    const p = slot.replace(() => {
      created = true;
      return makeRun();
    });
    // 让 replace 有机会往前推进：旧轮已被 abort，但 finished 未 resolve，
    // create 一定还没被调用（新轮不得在旧轮落库完成前启动）
    await Promise.resolve();
    expect(r0.aborted).toBe(true);
    expect(created).toBe(false);
    r0.finish();
    await p;
    expect(created).toBe(true);
  });

  it("two replaces racing into the drain window leave exactly one live run, all earlier runs aborted", async () => {
    const slot = new RunSlot<TestRun>();
    const r0 = makeRun();
    await slot.replace(() => r0);
    // 新轮 finishOnAbort：drain 窗口里被并发对手 abort 后要能自行收尾，
    // 否则第二个 replace 会永远等不到 finished
    const r1 = makeRun({ finishOnAbort: true });
    const r2 = makeRun({ finishOnAbort: true });
    const p1 = slot.replace(() => r1);
    const p2 = slot.replace(() => r2);
    // 两个 replace 都打进了 r0 的 drain 窗口：r0 已被 abort，槽位还没换
    expect(r0.aborted).toBe(true);
    expect(slot.current).toBe(r0);
    r0.finish();
    await Promise.all([p1, p2]);
    // 终态不变量（不依赖 p1/p2 的 resume 顺序）：恰好一轮存活占槽，
    // 另一轮曾短暂占槽但被后来者 drain（abort + 等到 finished）
    const survivor = slot.current;
    expect([r1, r2]).toContain(survivor);
    const loser = survivor === r1 ? r2 : r1;
    expect(survivor?.aborted).toBe(false);
    expect(survivor?.done).toBe(false);
    expect(loser.aborted).toBe(true);
    expect(loser.done).toBe(true);
    expect(r0.aborted).toBe(true);
  });
});
