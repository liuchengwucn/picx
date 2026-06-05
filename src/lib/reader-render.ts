/**
 * 把 MinerU 解析结果 zip 渲染为可直接展示的 markdown。
 *
 * 纯函数，核心可测单元：解包 zip，找到 markdown，把图片引用替换为内联 data URI。
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

/**
 * 把 Uint8Array 转 base64。分块处理以避免 String.fromCharCode 栈溢出。
 * Workers 运行时与现代 Node 均提供全局 btoa。
 */
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function getExtension(path: string): string {
  const lower = path.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  return dotIndex === -1 ? "" : lower.slice(dotIndex + 1);
}

function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function basename(path: string): string {
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

/**
 * 把 markdown 里所有图片引用(markdown 的 `![](url)` 与内嵌 HTML 的 `<img src>`)
 * 整体替换为内联 data URI。
 *
 * 用「整体重写引用 URL」而非盲目 split 子串:MinerU 的 zip 偶尔把内容放在子目录下
 * (如 `xxx/images/a.jpg`),而 full.md 里只写 `images/a.jpg` 甚至裸文件名 —— 路径对不上
 * 就会整篇丢图。解析按三级兜底:精确路径 → 末尾路径片段 → 唯一 basename。
 */
function inlineImages(
  markdown: string,
  resolve: (url: string) => string | null,
) {
  const rewriteUrl = (rawUrl: string): string | null => {
    const url = rawUrl.trim().replace(/^<|>$/g, "");
    if (!url || url.startsWith("data:")) {
      return null;
    }
    return resolve(url);
  };

  // markdown 图片:![alt](url "title") —— 只动 url 段,保留可选标题。
  let out = markdown.replace(
    /(!\[[^\]]*\]\(\s*)([^)\s]+)/g,
    (full, prefix: string, rawUrl: string) => {
      const uri = rewriteUrl(rawUrl);
      return uri ? `${prefix}${uri}` : full;
    },
  );

  // 内嵌 HTML:<img ... src="url" ...>
  out = out.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
    (full, prefix: string, rawUrl: string, suffix: string) => {
      const uri = rewriteUrl(rawUrl);
      return uri ? `${prefix}${uri}${suffix}` : full;
    },
  );

  return out;
}

export function renderZip(zipBytes: Uint8Array): {
  title: string | null;
  markdown: string;
} {
  const entries = unzipSync(zipBytes);
  const entryNames = Object.keys(entries);

  // 找 markdown：优先 full.md，否则取第一个 .md 结尾的条目。
  let markdownName: string | undefined = entryNames.find(
    (name) => name === "full.md",
  );
  if (!markdownName) {
    markdownName = entryNames.find((name) =>
      name.toLowerCase().endsWith(".md"),
    );
  }

  if (!markdownName) {
    return { title: null, markdown: "" };
  }

  const markdown = strFromU8(entries[markdownName]);

  // 预先把每个图片条目编码为 data URI,并建 basename → 条目 的映射用于兜底解析。
  const imageEntries = entryNames.filter(
    (name) => isImagePath(name) && MIME_BY_EXT[getExtension(name)],
  );
  const uriByEntry = new Map<string, string>();
  const entriesByBasename = new Map<string, string[]>();
  for (const name of imageEntries) {
    const mime = MIME_BY_EXT[getExtension(name)];
    uriByEntry.set(name, `data:${mime};base64,${bytesToBase64(entries[name])}`);
    const base = basename(name);
    const list = entriesByBasename.get(base) ?? [];
    list.push(name);
    entriesByBasename.set(base, list);
  }

  const resolve = (rawUrl: string): string | null => {
    // 去掉查询串/锚点与 ./ 前缀。
    const url = rawUrl.split(/[?#]/)[0].replace(/^\.\//, "");
    // 1) 精确路径。
    const exact = uriByEntry.get(url);
    if (exact) {
      return exact;
    }
    // 2) 末尾路径片段(markdown 路径缺了目录前缀)。
    for (const name of imageEntries) {
      if (name.endsWith(`/${url}`)) {
        return uriByEntry.get(name) ?? null;
      }
    }
    // 3) basename 唯一兜底(避免同名歧义时误替换)。
    const matches = entriesByBasename.get(basename(url));
    if (matches && matches.length === 1) {
      return uriByEntry.get(matches[0]) ?? null;
    }
    return null;
  };

  return {
    title: extractTitle(markdown),
    markdown:
      imageEntries.length > 0 ? inlineImages(markdown, resolve) : markdown,
  };
}
