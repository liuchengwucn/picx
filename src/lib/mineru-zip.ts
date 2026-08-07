/**
 * MinerU 结果 zip 的通用解析层。
 *
 * reader（内联 data URI）与论文管线（图片落 R2、markdown 存相对路径）共用：
 * 解包、定位 markdown、枚举图片、三级兜底的图片引用解析与重写。
 */

import { strFromU8, unzipSync } from "fflate";
import { cleanMineruMarkdown } from "./mineru-clean";

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

/**
 * storedName 会同时进入 R2 key 与 markdown 图片引用，空格/括号等字符会破坏
 * `![](images/x.png)` 的往返解析。MinerU 的图片名通常是 hash，此处只是防御。
 */
function sanitizeStoredBasename(base: string): string {
  return base.replace(/[^\w.-]+/g, "_");
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
  /**
   * 去目录、清洗非安全字符、去冲突后的存储名。
   * 清洗后的 basename 唯一时即该 basename，否则 `${序号}-${basename}`。
   */
  storedName: string;
  mime: string;
  bytes: Uint8Array;
}

export interface MineruZipContent {
  /** 已做乱码清洗（cleanMineruMarkdown）的 markdown，图片引用未重写。 */
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

  // 落盘前清洗 MinerU 的系统性乱码（连字误读、sub/sup 误判），在
  // extractTitle 之前应用，标题提取同样受益。
  const markdown = cleanMineruMarkdown(strFromU8(entries[markdownName]));

  const imageNames = entryNames.filter(
    (name) => isImagePath(name) && MIME_BY_EXT[getExtension(name)],
  );

  // basename 冲突计数，决定 storedName。先清洗再计数：清洗本身也可能制造冲突
  // （`a b.png` 与 `a_b.png` 清洗后同名），必须一并计入。
  const basenameCount = new Map<string, number>();
  for (const name of imageNames) {
    const base = sanitizeStoredBasename(basename(name));
    basenameCount.set(base, (basenameCount.get(base) ?? 0) + 1);
  }

  const images: MineruZipImage[] = imageNames.map((name, i) => {
    const base = sanitizeStoredBasename(basename(name));
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
 *
 * 返回命中的图片本身而非 URL：调用方据此既能生成 URL，也能知道哪些图片真被引用到
 * （见 rewriteImageRefs 的 referencedStoredNames）。
 */
export function buildImageResolver(
  images: MineruZipImage[],
): (rawUrl: string) => MineruZipImage | null {
  const byEntry = new Map(images.map((img) => [img.entryName, img]));
  const byBasename = new Map<string, MineruZipImage[]>();
  for (const img of images) {
    const base = basename(img.entryName);
    const list = byBasename.get(base) ?? [];
    list.push(img);
    byBasename.set(base, list);
  }

  return (rawUrl: string): MineruZipImage | null => {
    const url = rawUrl.split(/[?#]/)[0].replace(/^\.\//, "");
    const exact = byEntry.get(url);
    if (exact) {
      return exact;
    }
    for (const img of images) {
      if (img.entryName.endsWith(`/${url}`)) {
        return img;
      }
    }
    const matches = byBasename.get(basename(url));
    if (matches && matches.length === 1) {
      return matches[0];
    }
    return null;
  };
}

export interface RewrittenMarkdown {
  markdown: string;
  /**
   * 重写过程中真正命中的图片 storedName 集合，即重写后的 markdown 实际引用到的图片。
   *
   * MinerU 的 zip 里约半数图片（表格/公式区域的裁图）从不被 markdown 引用 —— 它们在
   * markdown 里被渲染成 HTML `<table>` / LaTeX。论文管线据此只把被引用的图片写进 R2，
   * 避免存一堆死图。集合由重写过程本身产出，天然与 resolver 的三级兜底一致，
   * 不会因为调用方二次正则扫描 markdown 而错判。
   */
  referencedStoredNames: Set<string>;
}

/**
 * 重写 markdown 中所有图片引用（`![](url)` 与内嵌 `<img src>`）。
 * resolve 返回 null 时保留原引用。逻辑整体迁自 reader-render 的 inlineImages。
 */
export function rewriteImageRefs(
  markdown: string,
  resolve: (url: string) => MineruZipImage | null,
  toUrl: (img: MineruZipImage) => string,
): RewrittenMarkdown {
  const referencedStoredNames = new Set<string>();

  const rewriteUrl = (rawUrl: string): string | null => {
    const url = rawUrl.trim().replace(/^<|>$/g, "");
    if (!url || url.startsWith("data:")) {
      return null;
    }
    const img = resolve(url);
    if (!img) {
      return null;
    }
    referencedStoredNames.add(img.storedName);
    return toUrl(img);
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

  return { markdown: out, referencedStoredNames };
}
