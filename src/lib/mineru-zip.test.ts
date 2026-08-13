import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  basename,
  buildImageResolver,
  type MineruZipImage,
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

  it("sanitizes unsafe characters in storedName while keeping entryName intact", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "images/fig 1 (final).png": MINIMAL_PNG,
    });

    const { images } = parseMineruZip(zip);

    expect(images).toHaveLength(1);
    expect(images[0].storedName).toBe("fig_1_final_.png");
    expect(images[0].entryName).toBe("images/fig 1 (final).png");
  });

  it("counts conflicts after sanitizing so distinct entries never collide", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "dir1/a b.png": MINIMAL_PNG,
      "dir2/a_b.png": MINIMAL_PNG,
    });

    const { images } = parseMineruZip(zip);

    expect(images).toHaveLength(2);
    for (const img of images) {
      expect(img.storedName).toMatch(/^\d+-a_b\.png$/);
    }
    expect(new Set(images.map((img) => img.storedName)).size).toBe(2);
  });

  it("extracts pageCount from layout.json pdf_info length", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "layout.json": strToU8(
        JSON.stringify({ pdf_info: [{}, {}, {}], _backend: "vlm" }),
      ),
    });

    expect(parseMineruZip(zip).pageCount).toBe(3);
  });

  it("falls back to content_list max page_idx + 1 when layout.json is absent", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "abc_content_list.json": strToU8(
        JSON.stringify([
          { type: "text", page_idx: 0 },
          { type: "text", page_idx: 29 },
          { type: "text", page_idx: 12 },
        ]),
      ),
      // v2 形状不同，不应被当作 content_list 消费。
      "abc_content_list_v2.json": strToU8(JSON.stringify([{ foo: 1 }])),
    });

    expect(parseMineruZip(zip).pageCount).toBe(30);
  });

  it("falls back to content_list when layout.json has an unexpected shape", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "layout.json": strToU8(JSON.stringify({ pages: 3 })),
      "abc_content_list.json": strToU8(JSON.stringify([{ page_idx: 4 }])),
    });

    expect(parseMineruZip(zip).pageCount).toBe(5);
  });

  it("returns null pageCount when metadata is missing or malformed", () => {
    const noMeta = zipSync({ "full.md": strToU8("# T\n") });
    expect(parseMineruZip(noMeta).pageCount).toBeNull();

    const malformed = zipSync({
      "full.md": strToU8("# T\n"),
      "layout.json": strToU8("{not json"),
      "abc_content_list.json": strToU8("[broken"),
    });
    expect(parseMineruZip(malformed).pageCount).toBeNull();

    // 有 content_list 但没有任何数值 page_idx。
    const noIdx = zipSync({
      "full.md": strToU8("# T\n"),
      "abc_content_list.json": strToU8(JSON.stringify([{ type: "text" }])),
    });
    expect(parseMineruZip(noIdx).pageCount).toBeNull();
  });

  it("still reports pageCount when there is no markdown entry", () => {
    const zip = zipSync({
      "layout.json": strToU8(JSON.stringify({ pdf_info: [{}, {}] })),
    });

    const result = parseMineruZip(zip);

    expect(result.markdown).toBe("");
    expect(result.pageCount).toBe(2);
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
    const resolve = buildImageResolver(images);

    expect(resolve("images/a.png")?.entryName).toBe("images/a.png");
  });

  it("resolves via trailing path segment when zip nests content under a subdirectory", () => {
    const zip = zipSync({
      "doc/full.md": strToU8("# T\n"),
      "doc/images/a.jpg": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images);

    // md 内写的相对路径缺少 doc/ 前缀，zip 里实际条目却带前缀。
    expect(resolve("images/a.jpg")?.entryName).toBe("doc/images/a.jpg");
  });

  it("resolves a bare filename via unique basename fallback", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "images/a.png": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images);

    expect(resolve("a.png")?.entryName).toBe("images/a.png");
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
    const resolve = buildImageResolver(images);

    expect(resolve("images/a.png")).toBeNull();
  });

  it("returns null when there is no match at all", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "images/a.png": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images);

    expect(resolve("images/ghost.png")).toBeNull();
  });

  it("strips ./ prefix and query/hash before resolving", () => {
    const zip = zipSync({
      "full.md": strToU8("# T\n"),
      "images/a.png": MINIMAL_PNG,
    });
    const { images } = parseMineruZip(zip);
    const resolve = buildImageResolver(images);

    expect(resolve("./images/a.png")?.entryName).toBe("images/a.png");
    expect(resolve("images/a.png?x=1#y")?.entryName).toBe("images/a.png");
  });
});

describe("rewriteImageRefs", () => {
  const fakeImage = (storedName: string): MineruZipImage => ({
    entryName: `images/${storedName}`,
    storedName,
    mime: "image/png",
    bytes: MINIMAL_PNG,
  });
  const always = (storedName: string) => () => fakeImage(storedName);
  const toReplaced = () => "REPLACED";

  it("rewrites markdown image references", () => {
    const markdown = "![fig](images/a.png)";
    const out = rewriteImageRefs(markdown, always("a.png"), toReplaced);

    expect(out.markdown).toBe("![fig](REPLACED)");
    expect([...out.referencedStoredNames]).toEqual(["a.png"]);
  });

  it("rewrites inline <img src> references", () => {
    const markdown = '<img src="images/a.png" alt="x" />';
    const out = rewriteImageRefs(markdown, always("a.png"), toReplaced);

    expect(out.markdown).toContain('src="REPLACED"');
    expect([...out.referencedStoredNames]).toEqual(["a.png"]);
  });

  it("skips data: URIs", () => {
    const markdown = "![fig](data:image/png;base64,AAAA)";
    const out = rewriteImageRefs(markdown, always("a.png"), toReplaced);

    expect(out.markdown).toBe(markdown);
    expect(out.referencedStoredNames.size).toBe(0);
  });

  it("keeps the original reference unchanged when resolve returns null", () => {
    const markdown = "![fig](images/ghost.png)";
    const out = rewriteImageRefs(markdown, () => null, toReplaced);

    expect(out.markdown).toBe(markdown);
    expect(out.referencedStoredNames.size).toBe(0);
  });

  it("reports only the stored names the markdown actually references", () => {
    // MinerU 把表格/公式区域也裁成图片放进 zip，markdown 却渲染成 HTML/LaTeX
    // 而从不引用它们 —— 这些图片不应被存储。
    const zip = zipSync({
      "full.md": strToU8(
        "# T\n\n![fig1](images/used.png)\n\n<table><tr><td>x</td></tr></table>\n",
      ),
      "images/used.png": MINIMAL_PNG,
      "images/table_crop.png": MINIMAL_PNG,
      "images/formula_crop.png": MINIMAL_PNG,
    });
    const { markdown, images } = parseMineruZip(zip);

    const out = rewriteImageRefs(
      markdown,
      buildImageResolver(images),
      (img) => `images/${img.storedName}`,
    );

    expect(images).toHaveLength(3);
    expect([...out.referencedStoredNames]).toEqual(["used.png"]);
    expect(
      images.filter((img) => out.referencedStoredNames.has(img.storedName)),
    ).toHaveLength(1);
  });

  it("counts images reached through the resolver's path fallbacks as referenced", () => {
    // zip 把内容嵌在子目录里，md 里写的却是相对名/裸文件名 —— 二三级兜底命中的
    // 图片同样算被引用（正则二次扫描 markdown 就会漏掉这类）。
    const zip = zipSync({
      "doc/full.md": strToU8(
        "# T\n\n![a](images/nested.png)\n\n![b](bare.png)\n",
      ),
      "doc/images/nested.png": MINIMAL_PNG,
      "doc/deep/sub/bare.png": MINIMAL_PNG,
      "doc/images/unused.png": MINIMAL_PNG,
    });
    const { markdown, images } = parseMineruZip(zip);

    const out = rewriteImageRefs(
      markdown,
      buildImageResolver(images),
      (img) => `images/${img.storedName}`,
    );

    expect([...out.referencedStoredNames].sort()).toEqual([
      "bare.png",
      "nested.png",
    ]);
    expect(out.markdown).toContain("![a](images/nested.png)");
    expect(out.markdown).toContain("![b](images/bare.png)");
  });
});
