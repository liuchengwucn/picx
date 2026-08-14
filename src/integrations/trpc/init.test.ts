import { TRPCError } from "@trpc/server";
import { getTRPCErrorFromUnknown } from "@trpc/server/unstable-core-do-not-import";
import { describe, expect, it } from "vitest";
import { sanitizeErrorShape } from "./init";

// 形状字段以 message/data.stack 为主，其余字段原样透传即可
const shape = {
  message: "",
  code: -32603,
  data: { path: "x", stack: "DrizzleQueryError: Failed query: ..." },
};

describe("sanitizeErrorShape", () => {
  it("replaces message and strips data.stack for a wrapped non-TRPCError", () => {
    // 走 tRPC 真实包装路径（而非手工构造），钉住「message 继承自 cause」的承重假设
    const leaky = getTRPCErrorFromUnknown(
      new Error(
        'Failed query: insert into "papers" ... params: user-secret-content',
      ),
    );
    const out = sanitizeErrorShape({ ...shape, message: leaky.message }, leaky);
    expect(out.message).toBe("Internal server error");
    expect(out.data).toEqual({ path: "x" });
    expect("stack" in out.data).toBe(false);
  });

  it("sanitizes a thrown string (tRPC converts primitives to Error before wrapping)", () => {
    const leaky = getTRPCErrorFromUnknown("Failed query: ... secret params");
    expect(leaky.cause).toBeInstanceOf(Error);
    const out = sanitizeErrorShape({ ...shape, message: leaky.message }, leaky);
    expect(out.message).toBe("Internal server error");
  });

  it("keeps an intentional ISE with a hand-written message even when a cause is attached", () => {
    const intentional = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create paper",
      cause: new Error("underlying detail"),
    });
    const out = sanitizeErrorShape(
      { ...shape, message: intentional.message },
      intentional,
    );
    expect(out.message).toBe("Failed to create paper");
    expect(out.data.stack).toBe(shape.data.stack);
  });

  it("keeps an intentional ISE without a cause", () => {
    const intentional = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Whiteboard generation failed",
    });
    const out = sanitizeErrorShape(
      { ...shape, message: intentional.message },
      intentional,
    );
    expect(out.message).toBe("Whiteboard generation failed");
  });

  it("keeps an ISE whose cause is itself a TRPCError (hand-written safe message inherited)", () => {
    const inner = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Upstream service unavailable",
    });
    // 不传 message：构造器继承 cause.message，若无 TRPCError 豁免子句会被误脱敏
    const outer = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: inner });
    expect(outer.message).toBe(inner.message);
    const out = sanitizeErrorShape(
      { ...shape, message: outer.message },
      outer,
    );
    expect(out.message).toBe("Upstream service unavailable");
  });

  it("keeps non-ISE codes untouched (zod BAD_REQUEST payloads must survive)", () => {
    const zodLike = new TRPCError({
      code: "BAD_REQUEST",
      cause: new Error('[{"path":["title"],"message":"Required"}]'),
    });
    const out = sanitizeErrorShape(
      { ...shape, message: zodLike.message },
      zodLike,
    );
    expect(out.message).toBe(zodLike.message);
  });
});
