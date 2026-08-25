// src/lib/feed/xml.ts
import { escapeHtml } from "#/lib/embed-code";

/**
 * 剥掉 XML 1.0 禁止出现的字符。
 *
 * 这不是洁癖：本站正文来自 LLM 生成与 PDF 解析管线，已经出现过 U+FFFD 一类脏
 * 字符。XML 1.0 里 C0 控制字符**连转义成 &#1; 都非法**，一条脏 story 会让整份
 * feed 在阅读器里整体解析失败 —— 不是那一条不显示，是整个订阅源报错。
 *
 * for...of 按码点遍历：配对的代理项会合成一个 >0xFFFF 的码点，所以落在
 * 0xD800-0xDFFF 区间的一定是未配对代理项（同样会让 XML 序列化失败）。
 */
export function stripInvalidXmlChars(value: string): string {
  let out = "";
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      out += ch;
      continue;
    }
    if (cp < 0x20) continue;
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (cp === 0xfffe || cp === 0xffff) continue;
    out += ch;
  }
  return out;
}

/**
 * XML 文本节点 / 属性值转义。escapeHtml 转 & < > " ' 且用数字实体 &#39;，
 * XML 预定义实体全覆盖，不需要另写一份。
 */
export function xmlText(value: string): string {
  return escapeHtml(stripInvalidXmlChars(value));
}
