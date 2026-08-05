/**
 * MinerU 结果 zip 的通用解析层。
 *
 * reader（内联 data URI）与论文管线（图片落 R2、markdown 存相对路径）共用：
 * 解包、定位 markdown、枚举图片、三级兜底的图片引用解析与重写。
 */

import { strFromU8, unzipSync } from "fflate";

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
];

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

function getExtension(path: string): string {
  const lower = path.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  return dotIndex === -1 ? "" : lower.slice(dotIndex + 1);
}

function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function extractTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (!match) {
    return null;
  }
  const title = match[1].trim();
  return title.length > 0 ? title : null;
}

export interface MineruZipImage {
  /** zip 内完整条目路径（如 `sub/images/a.jpg`）。 */
  entryName: string;
  /** 去目录、去冲突后的存储名。basename 唯一时即 basename，否则 `${序号}-${basename}`。 */
  storedName: string;
  mime: string;
  bytes: Uint8Array;
}

export interface MineruZipContent {
  /** 原始 markdown，图片引用未重写。 */
  markdown: string;
  title: string | null;
  images: MineruZipImage[];
}

export function parseMineruZip(zipBytes: Uint8Array): MineruZipContent {
  const entries = unzipSync(zipBytes);
  const entryNames = Object.keys(entries);

  let markdownName: string | undefined = entryNames.find(
    (name) => name === "full.md",
  );
  if (!markdownName) {
    markdownName = entryNames.find((name) =>
      name.toLowerCase().endsWith(".md"),
    );
  }

  if (!markdownName) {
    return { markdown: "", title: null, images: [] };
  }

  const markdown = strFromU8(entries[markdownName]);

  const imageNames = entryNames.filter(
    (name) => isImagePath(name) && MIME_BY_EXT[getExtension(name)],
  );

  // basename 冲突计数，决定 storedName。
  const basenameCount = new Map<string, number>();
  for (const name of imageNames) {
    const base = basename(name);
    basenameCount.set(base, (basenameCount.get(base) ?? 0) + 1);
  }

  const images: MineruZipImage[] = imageNames.map((name, i) => {
    const base = basename(name);
    return {
      entryName: name,
      storedName: (basenameCount.get(base) ?? 0) > 1 ? `${i}-${base}` : base,
      mime: MIME_BY_EXT[getExtension(name)],
      bytes: entries[name],
    };
  });

  return { markdown, title: extractTitle(markdown), images };
}

/**
 * 三级兜底解析（沿自 reader 实测经验，MinerU 偶尔把内容放子目录而 md 里只写相对名）：
 * 精确条目路径 → 末尾路径片段 → 唯一 basename。
 */
export function buildImageResolver(
  images: MineruZipImage[],
  toUrl: (img: MineruZipImage) => string,
): (rawUrl: string) => string | null {
  const byEntry = new Map(images.map((img) => [img.entryName, img]));
  const byBasename = new Map<string, MineruZipImage[]>();
  for (const img of images) {
    const base = basename(img.entryName);
    const list = byBasename.get(base) ?? [];
    list.push(img);
    byBasename.set(base, list);
  }

  return (rawUrl: string): string | null => {
    const url = rawUrl.split(/[?#]/)[0].replace(/^\.\//, "");
    const exact = byEntry.get(url);
    if (exact) {
      return toUrl(exact);
    }
    for (const img of images) {
      if (img.entryName.endsWith(`/${url}`)) {
        return toUrl(img);
      }
    }
    const matches = byBasename.get(basename(url));
    if (matches && matches.length === 1) {
      return toUrl(matches[0]);
    }
    return null;
  };
}

/**
 * 重写 markdown 中所有图片引用（`![](url)` 与内嵌 `<img src>`）。
 * resolve 返回 null 时保留原引用。逻辑整体迁自 reader-render 的 inlineImages。
 */
export function rewriteImageRefs(
  markdown: string,
  resolve: (url: string) => string | null,
): string {
  const rewriteUrl = (rawUrl: string): string | null => {
    const url = rawUrl.trim().replace(/^<|>$/g, "");
    if (!url || url.startsWith("data:")) {
      return null;
    }
    return resolve(url);
  };

  let out = markdown.replace(
    /(!\[[^\]]*\]\(\s*)([^)\s]+)/g,
    (full, prefix: string, rawUrl: string) => {
      const uri = rewriteUrl(rawUrl);
      return uri ? `${prefix}${uri}` : full;
    },
  );

  out = out.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
    (full, prefix: string, rawUrl: string, suffix: string) => {
      const uri = rewriteUrl(rawUrl);
      return uri ? `${prefix}${uri}${suffix}` : full;
    },
  );

  return out;
}
