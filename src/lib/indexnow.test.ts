import { describe, expect, it } from "vitest";
import { buildIndexNowSubmission } from "./indexnow";

describe("buildIndexNowSubmission", () => {
  const input = {
    siteUrl: "https://picx.dev",
    key: "0123456789abcdef0123456789abcdef",
    urls: ["https://picx.dev/p/abc123", "https://picx.dev/p/abc123.md"],
  };

  it("targets the IndexNow api endpoint", () => {
    const { endpoint } = buildIndexNowSubmission(input);
    expect(endpoint).toBe("https://api.indexnow.org/indexnow");
  });

  it("derives the bare host from the site url", () => {
    const { body } = buildIndexNowSubmission(input);
    expect(body.host).toBe("picx.dev");
  });

  it("passes the key and a same-host key location", () => {
    const { body } = buildIndexNowSubmission(input);
    expect(body.key).toBe("0123456789abcdef0123456789abcdef");
    expect(body.keyLocation).toBe("https://picx.dev/indexnow-key.txt");
  });

  it("lists every submitted url", () => {
    const { body } = buildIndexNowSubmission(input);
    expect(body.urlList).toEqual([
      "https://picx.dev/p/abc123",
      "https://picx.dev/p/abc123.md",
    ]);
  });
});
