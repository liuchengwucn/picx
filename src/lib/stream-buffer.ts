/**
 * 一次生成的 SSE 行缓冲：新订阅者先整段重放已缓冲的行，再实时跟进后续行。
 * ChatRunner DO 用它把「生成循环」与「响应流」解耦——初始 POST 的响应和
 * 断线后 GET resume 的响应都是订阅者，客户端断开只是少一个订阅者，
 * 生成循环无感继续。纯内存、无平台依赖，便于单测。
 */
export class StreamBuffer {
  private lines: string[] = [];
  private closed = false;
  private listeners = new Set<{
    enqueue(line: string): void;
    close(): void;
  }>();

  /** 追加一行并广播；某个订阅者的 controller 已死时把它移除，不影响其他订阅者 */
  append(line: string): void {
    if (this.closed) return;
    this.lines.push(line);
    for (const listener of [...this.listeners]) {
      try {
        listener.enqueue(line);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }

  /** 生成结束：关闭所有订阅流；之后的 subscribe 只重放不挂监听 */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of [...this.listeners]) {
      try {
        listener.close();
      } catch {
        // 订阅者已被客户端 cancel，无事可做
      }
    }
    this.listeners.clear();
  }

  get done(): boolean {
    return this.closed;
  }

  /** 重放 + 实时跟进的字节流（SSE 行已在 append 时编好帧，这里只做 UTF-8 编码） */
  subscribe(): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let listener: { enqueue(line: string): void; close(): void } | undefined;
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const line of this.lines) {
          controller.enqueue(encoder.encode(line));
        }
        if (this.closed) {
          controller.close();
          return;
        }
        listener = {
          enqueue: (line) => controller.enqueue(encoder.encode(line)),
          close: () => controller.close(),
        };
        this.listeners.add(listener);
      },
      cancel: () => {
        if (listener) this.listeners.delete(listener);
      },
    });
  }
}
