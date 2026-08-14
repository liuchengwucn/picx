import { describe, expect, it } from "vitest";
import { getContext } from "#/integrations/tanstack-query/root-provider";

describe("getContext", () => {
  it("returns a fresh queryClient on every call", () => {
    const first = getContext();
    const second = getContext();

    expect(first.queryClient).not.toBe(second.queryClient);
  });
});
