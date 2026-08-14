import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { sanitizeErrorShape } from "./init";

// 形状字段以 message 为主，其余字段原样透传即可
const shape = { message: "", code: -32603, data: { path: "x" } };

describe("sanitizeErrorShape", () => {
  it("replaces the message of a wrapped non-TRPCError (message inherited from cause)", () => {
    // 模拟 tRPC 对未处理异常的包装路径：不传 message，构造器直接取 cause.message
    const leaky = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: new Error(
        'Failed query: insert into "papers" ... params: user-secret-content',
      ),
    });
    const out = sanitizeErrorShape({ ...shape, message: leaky.message }, leaky);
    expect(out.message).toBe("Internal server error");
    expect(out.data).toEqual(shape.data);
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
