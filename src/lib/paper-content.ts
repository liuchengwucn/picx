/**
 * 论文原文内容（MinerU markdown + 图片）在 R2 的落盘约定，
 * 以及供 LLM/chatbot 使用的 markdown → 纯文本转换。
 *
 * markdown 内的图片引用统一为相对路径 `images/{storedName}`，渲染端负责映射到
 * 鉴权图片端点 —— markdown 本身保持可移植。
 */

export function paperContentMarkdownKey(paperId: string): string {
  return `paper-content/${paperId}/full.md`;
}

export function paperContentImageKey(
  paperId: string,
  storedName: string,
): string {
  return `paper-content/${paperId}/images/${storedName}`;
}

/** markdown 内引用图片时使用的相对路径。 */
export function markdownImagePath(storedName: string): string {
  return `images/${storedName}`;
}

/**
 * 把 MinerU markdown 转为喂给 LLM / chatbot 的纯文本：
 * - 去掉图片引用（markdown 图片与内嵌 <img>）
 * - 标题行去掉前导 `#`（既可读，也让 paper-tail 的标题正则可命中「References」等）
 * - 压缩连续 3+ 空行
 * 表格（HTML/管道表格）与公式原样保留 —— 对总结与问答都是有效信息。
 */
export function markdownToPlainText(markdown: string): string {
  let text = markdown.replace(/!\[[^\]]*\]\(\s*[^)]*\)/g, "");
  text = text.replace(/<img\b[^>]*>/gi, "");
  text = text.replace(/^(#{1,6})\s+/gm, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

// `<script>...</script>` / `<style>...</style>` 连内容一起删（脚本会执行，CSS 留着会被
// 当正文显示）；随后清掉未配对的孤立标签（未闭合的 `<script>` 若留下，渲染时会把其后的
// 正文都吞成脚本内容）。
const SCRIPT_BLOCK_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const STYLE_BLOCK_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const SCRIPT_TAG_RE = /<\/?(?:script|style)\b[^>]*>/gi;
// 这几个只需删标签本身，标签间的文本仍是论文正文，保留。
// meta（http-equiv=refresh 跳转）/ base（改写相对 URL 基址）/ link（外链样式）同样危险。
const DANGEROUS_TAG_RE =
  /<\/?(?:iframe|object|embed|form|meta|base|link)\b[^>]*>/gi;

/**
 * 剥离 MinerU markdown 中的危险 HTML（存储型 XSS 的源头处理）。
 *
 * 威胁模型：MinerU 会把 PDF 内的文本原样抄进 markdown —— 攻击者只要在 PDF 里
 * 写一段 `<script>` 或 `<iframe>`，解析产物就会带上它；原文视图用 rehypeRaw
 * 渲染裸 HTML（表格/公式需要），这段脚本就会真的执行。而公开论文的原文对任意
 * 登录用户可见，于是变成一次上传、他人渲染的存储型 XSS。
 *
 * 故在落盘前就清掉，R2 里的 full.md 与由它派生的纯文本都保持干净。这是纵深防御的
 * 第一层（黑名单）；渲染端 markdown-article.tsx 还有一层 rehype-sanitize 白名单，
 * 真正的安全边界在那儿 —— 黑名单只保证落盘内容本身干净。
 * 表格（`<table>/<tr>/<td>`）与 `<img>` 是论文正文的正常组成，不动。
 *
 * 单遍替换会被拼接绕过：`<scr<script>ipt>` 删掉中间的 `<script>` 后，两侧残片正好
 * 拼回一个完整的 `<script>`。故循环替换到不动点（上限 10 轮，防病态输入死循环）。
 */
export function stripDangerousHtml(markdown: string): string {
  let current = markdown;

  for (let pass = 0; pass < 10; pass++) {
    const next = current
      .replace(SCRIPT_BLOCK_RE, "")
      .replace(STYLE_BLOCK_RE, "")
      .replace(SCRIPT_TAG_RE, "")
      .replace(DANGEROUS_TAG_RE, "");

    if (next === current) {
      return current;
    }
    current = next;
  }

  return current;
}

export interface PseudoPage {
  pageNumber: number;
  startOffset: number;
  text: string;
}

/**
 * 把纯文本按行边界切成 ~chunkChars 的伪页，供 pdf.ts 的 trimPaperTail 复用
 * （其候选定位与 LLM 审核依赖页号/总页数信号）。
 */
export function buildPseudoPages(
  text: string,
  chunkChars = 3000,
): PseudoPage[] {
  if (text === "") {
    return [];
  }

  const pages: PseudoPage[] = [];
  const lines = text.split("\n");
  let current: string[] = [];
  let currentLen = 0;
  let offset = 0;
  let pageStart = 0;

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    pages.push({
      pageNumber: pages.length + 1,
      startOffset: pageStart,
      text: current.join("\n"),
    });
    current = [];
    currentLen = 0;
    pageStart = offset;
  };

  for (const line of lines) {
    current.push(line);
    currentLen += line.length + 1;
    offset += line.length + 1;
    if (currentLen >= chunkChars) {
      flush();
    }
  }
  flush();

  // offset 按「每行长度 +1(假设换行符)」累加,若原文本不以换行结尾,最后一行处理完
  // 后的 offset 会比文本实际长度多 1。但该值只在 flush() 里被写入 pageStart 供
  // *下一页* 使用 —— 若这是最后一行,循环结束后不会再有内容触发下一次 flush
  // (current 已清空,flush() 提前 return),这个多算的 offset 从未被当作某页的
  // startOffset 使用,故每页 startOffset 与 text 的对应关系始终成立。

  return pages;
}
