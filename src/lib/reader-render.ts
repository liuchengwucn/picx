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

function extractTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (!match) {
    return null;
  }
  const title = match[1].trim();
  return title.length > 0 ? title : null;
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

  let markdown = strFromU8(entries[markdownName]);

  // 把每个图片条目替换为内联 data URI（同时处理裸路径与 ./ 前缀）。
  for (const name of entryNames) {
    if (!isImagePath(name)) {
      continue;
    }

    const mime = MIME_BY_EXT[getExtension(name)];
    if (!mime) {
      continue;
    }

    const base64 = bytesToBase64(entries[name]);
    const dataUri = `data:${mime};base64,${base64}`;

    // 用字面量 split/join 替换，避免正则对特殊字符的转义问题。
    markdown = markdown.split(`./${name}`).join(dataUri);
    markdown = markdown.split(name).join(dataUri);
  }

  return { title: extractTitle(markdown), markdown };
}
