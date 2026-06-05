import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { renderZip } from "./reader-render";

// 最小合法 1x1 PNG 的字节。
const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

describe("renderZip", () => {
  it("uses full.md, extracts the H1 title, and inlines images as data URI", () => {
    const zip = zipSync({
      "full.md": strToU8("# Hello World\n\n![fig](images/a.png)\n"),
      "images/a.png": MINIMAL_PNG,
    });

    const { title, markdown } = renderZip(zip);

    expect(title).toBe("Hello World");
    expect(markdown).toContain("data:image/png;base64,");
    expect(markdown).not.toContain("images/a.png");
  });

  it("returns null title when there is no H1 heading", () => {
    const zip = zipSync({
      "full.md": strToU8("Just a paragraph, no heading.\n"),
    });

    const { title } = renderZip(zip);

    expect(title).toBeNull();
  });

  it("keeps references to missing images unchanged and does not throw", () => {
    const zip = zipSync({
      "full.md": strToU8("# Title\n\n![missing](images/ghost.png)\n"),
    });

    expect(() => renderZip(zip)).not.toThrow();

    const { markdown } = renderZip(zip);
    expect(markdown).toContain("images/ghost.png");
  });

  it("falls back to the first *.md when there is no full.md", () => {
    const zip = zipSync({
      "other.md": strToU8("# From Other\n\nbody\n"),
    });

    const { title, markdown } = renderZip(zip);

    expect(title).toBe("From Other");
    expect(markdown).toContain("body");
  });

  it("handles the ./ prefixed image reference too", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n\n![fig](./images/a.png)\n"),
      "images/a.png": MINIMAL_PNG,
    });

    const { markdown } = renderZip(zip);

    expect(markdown).toContain("data:image/png;base64,");
    expect(markdown).not.toContain("images/a.png");
    expect(markdown).not.toContain("./images/a.png");
  });

  it("inlines when the zip nests content under a subdirectory", () => {
    // full.md 在子目录里、图片路径相对 md 写,zip 条目却带子目录前缀。
    const zip = zipSync({
      "doc/full.md": strToU8("# T\n\n![fig](images/a.png)\n"),
      "doc/images/a.png": MINIMAL_PNG,
    });

    const { markdown } = renderZip(zip);

    expect(markdown).toContain("data:image/png;base64,");
    expect(markdown).not.toContain("](images/a.png)");
  });

  it("inlines a bare filename reference via unique basename", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n\n![fig](a.png)\n"),
      "images/a.png": MINIMAL_PNG,
    });

    const { markdown } = renderZip(zip);

    expect(markdown).toContain("data:image/png;base64,");
    expect(markdown).not.toContain("](a.png)");
  });

  it("inlines an inline HTML <img src> reference", () => {
    const zip = zipSync({
      "full.md": strToU8('# T\n\n<img src="images/a.png" alt="x" />\n'),
      "images/a.png": MINIMAL_PNG,
    });

    const { markdown } = renderZip(zip);

    expect(markdown).toContain("data:image/png;base64,");
    expect(markdown).not.toContain('src="images/a.png"');
  });
});
