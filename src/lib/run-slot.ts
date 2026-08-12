/**
 * 「一个槽位最多一轮在跑」的 supersede 原语，ChatRunner DO 用它管当前生成轮。
 * 纯内存、无平台依赖，便于单测钉住并发交错。
 *
 * 关键不变量：drain 循环退出到占槽赋值之间没有任何 await。若写成
 * if + 单次 await，两个并发 replace 同时打进 drain 窗口（await 旧轮
 * finished 期间）时会各自占槽一次——先占的那轮被覆盖却没人 abort，
 * 两轮并发生成同时写 D1。while 版本下，后 resume 的调用者会把先占槽的
 * 那轮也 drain 掉：任意交错的终态都是「恰好最后一轮存活，此前所有轮
 * 都被 abort 并等到 finished（落库完成）」。
 */
export interface SlotRun {
  /** 该轮是否已整体结束（结束后 replace 无需再 abort/等待它） */
  readonly done: boolean;
  abort(): void;
  /** 该轮生成循环（含落库）整体完成 */
  readonly finished: Promise<void>;
}

export class RunSlot<T extends SlotRun> {
  private run: T | null = null;

  /** 当前占槽的一轮（可能已结束）；从没跑过时为 null */
  get current(): T | null {
    return this.run;
  }

  /**
   * drain 掉所有还在跑的旧轮（含 drain 期间被并发 replace 抢先占槽的），
   * 再调 create 开新轮占槽。create 在 drain 完成后才执行——保证新轮启动时
   * 旧轮已把部分内容落完库。返回新占槽的那轮（而不是让调用方回读
   * current：replace resolve 后再读，槽位可能已被更晚的并发 replace
   * drain/换掉）。
   */
  async replace(create: () => T): Promise<T> {
    while (this.run && !this.run.done) {
      this.run.abort();
      await this.run.finished;
    }
    // 循环退出 → create → 赋值之间无 await：占槽是原子的
    const next = create();
    this.run = next;
    return next;
  }
}
