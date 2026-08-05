import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  basename,
  buildImageResolver,
  parseMineruZip,
  rewriteImageRefs,
} from "./mineru-zip";

// 最小合法 1x1 PNG 的字节。
const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

describe("basename", () => {
  it("returns the trailing path segment", () => {
    expect(basename("sub/images/a.jpg")).toBe("a.jpg");
    expect(basename("a.jpg")).toBe("a.jpg");
  });
});

describe("parseMineruZip", () => {
  it("prefers full.md over other .md entries", () => {
    const zip = zipSync({
      "other.md": strToU8("# Other\n"),
      "full.md": strToU8("# Full\n"),
    });

    const { title, markdown } = parseMineruZip(zip);

    expect(title).toBe("Full");
    expect(markdown).toContain("# Full");
  });

  it("falls back to the first *.md entry when there is no full.md", () => {
    const zip = zipSync({
      "other.md": strToU8("# Other\n\nbody\n"),
    });

    const { title, markdown } = parseMineruZip(zip);

    expect(title).toBe("Other");
    expect(markdown).toContain("body");
  });

  it("returns empty markdown/title/images when there is no markdown entry", () => {
    const zip = zipSync({
      "images/a.png": MINIMAL_PNG,
    });

    const result = parseMineruZip(zip);

    expect(result.markdown).toBe("");
    expect(result.title).toBeNull();
    expect(result.images).toEqual([]);
  });

  it("returns null title when there is no H1 heading", () => {
    const zip = zipSync({
      "full.md": strToU8("Just a paragraph, no heading.\n"),
    });

    const { title } = parseMineruZip(zip);

    expect(title).toBeNull();
  });

  it("assigns storedName = basename when there is no basename conflict", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "sub/images/a.jpg": MINIMAL_PNG,
    });

    const { images } = parseMineruZip(zip);

    expect(images).toHaveLength(1);
    expect(images[0].storedName).toBe("a.jpg");
    expect(images[0].entryName).toBe("sub/images/a.jpg");
    expect(images[0].mime).toBe("image/jpeg");
  });

  it("prefixes storedName with an index when basenames conflict", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "dir1/a.jpg": MINIMAL_PNG,
      "dir2/a.jpg": MINIMAL_PNG,
    });

    const { images } = parseMineruZip(zip);

    expect(images).toHaveLength(2);
    const storedNames = images.map((img) => img.storedName).sort();
    expect(storedNames).toEqual(images.map((_img, i) => `${i}-a.jpg`).sort());
    // 每个 storedName 都带序号前缀，且各不相同。
    for (const img of images) {
      expect(img.storedName).toMatch(/^\d+-a\.jpg$/);
    }
    expect(new Set(images.map((img) => img.storedName)).size).toBe(2);
  });

  it("ignores non-image entries", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "data.json": strToU8("{}"),
    });

    const { images } = parseMineruZip(zip);

    expect(images).toEqual([]);
  });
});

describe("buildImageResolver", () => {
  it("resolves via exact entry path", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "images/a.png": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images, (img) => `URI:${img.entryName}`);

    expect(resolve("images/a.png")).toBe("URI:images/a.png");
  });

  it("resolves via trailing path segment when zip nests content under a subdirectory", () => {
    const zip = zipSync({
      "doc/full.md": strToU8("# T\n"),
      "doc/images/a.jpg": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images, (img) => `URI:${img.entryName}`);

    // md 内写的相对路径缺少 doc/ 前缀，zip 里实际条目却带前缀。
    expect(resolve("images/a.jpg")).toBe("URI:doc/images/a.jpg");
  });

  it("resolves a bare filename via unique basename fallback", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "images/a.png": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images, (img) => `URI:${img.entryName}`);

    expect(resolve("a.png")).toBe("URI:images/a.png");
  });

  it("returns null on ambiguous basename matches", () => {
    // 两个候选的 basename 相同，但请求路径既非精确匹配、也不是任一条目的
    // 末尾路径片段（第二级兜底不命中），只能落到第三级 basename 兜底 —— 存在
    // 多个候选时视为歧义，返回 null 而不是随便替换成其中一个。
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "dir1/sub/a.png": MINIMAL_PNG,
      "dir2/other/a.png": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images, (img) => `URI:${img.entryName}`);

    expect(resolve("images/a.png")).toBeNull();
  });

  it("returns null when there is no match at all", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "images/a.png": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images, (img) => `URI:${img.entryName}`);

    expect(resolve("images/ghost.png")).toBeNull();
  });

  it("strips ./ prefix and query/hash before resolving", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "images/a.png": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images, (img) => `URI:${img.entryName}`);

    expect(resolve("./images/a.png")).toBe("URI:images/a.png");
    expect(resolve("images/a.png?x=1#y")).toBe("URI:images/a.png");
  });
});

describe("rewriteImageRefs", () => {
  it("rewrites markdown image references", () => {
    const markdown = "![fig](images/a.png)";
    const out = rewriteImageRefs(markdown, () => "REPLACED");

    expect(out).toBe("![fig](REPLACED)");
  });

  it("rewrites inline <img src> references", () => {
    const markdown = '<img src="images/a.png" alt="x" />';
    const out = rewriteImageRefs(markdown, () => "REPLACED");

    expect(out).toContain('src="REPLACED"');
  });

  it("skips data: URIs", () => {
    const markdown = "![fig](data:image/png;base64,AAAA)";
    const out = rewriteImageRefs(markdown, () => "REPLACED");

    expect(out).toBe(markdown);
  });

  it("keeps the original reference unchanged when resolve returns null", () => {
    const markdown = "![fig](images/ghost.png)";
    const out = rewriteImageRefs(markdown, () => null);

    expect(out).toBe(markdown);
  });
});
