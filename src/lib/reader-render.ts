/**
 * 把 MinerU 解析结果 zip 渲染为可直接展示的 markdown。
 *
 * 纯函数，核心可测单元：解包 zip（复用 mineru-zip.ts），把图片引用替换为内联 data URI。
 */

import {
  buildImageResolver,
  parseMineruZip,
  rewriteImageRefs,
} from "./mineru-zip";

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

export function renderZip(zipBytes: Uint8Array): {
  title: string | null;
  markdown: string;
} {
  const { markdown, title, images } = parseMineruZip(zipBytes);

  if (images.length === 0) {
    return { title, markdown };
  }

  const uriByEntry = new Map(
    images.map((img) => [
      img.entryName,
      `data:${img.mime};base64,${bytesToBase64(img.bytes)}`,
    ]),
  );
  const resolve = buildImageResolver(
    images,
    (img) => uriByEntry.get(img.entryName) as string,
  );

  return { title, markdown: rewriteImageRefs(markdown, resolve) };
}
