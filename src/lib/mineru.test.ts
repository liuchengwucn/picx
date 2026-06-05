import { describe, expect, it } from "vitest";
import { normalizeMineruState } from "./mineru";

describe("normalizeMineruState", () => {
  it("maps every known raw state", () => {
    expect(normalizeMineruState("waiting-file")).toBe("uploading");
    expect(normalizeMineruState("pending")).toBe("pending");
    expect(normalizeMineruState("running")).toBe("running");
    expect(normalizeMineruState("converting")).toBe("running");
    expect(normalizeMineruState("done")).toBe("done");
    expect(normalizeMineruState("failed")).toBe("failed");
  });

  it("maps unknown values to pending", () => {
    expect(normalizeMineruState("something-else")).toBe("pending");
    expect(normalizeMineruState("")).toBe("pending");
  });
});
