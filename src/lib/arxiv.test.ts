import { describe, expect, it } from "vitest";
import { isArxivLink } from "./arxiv";

describe("isArxivLink", () => {
  // 分流判据，直接决定 sourceType 与是否写 canonical source_url。
  // 判错的代价不是显示瑕疵：误判成 arXiv 会导入一篇完全不相干的论文并向用户
  // 计费，或把捏造的 source_url 写进去重索引。所以用例按「必须为真 / 必须为假」
  // 两张表穷举，尤其钉死曾经漏过的第三方链接。
  const ARXIV: Array<[label: string, input: string]> = [
    ["abs URL", "https://arxiv.org/abs/2301.12345"],
    ["pdf URL with version", "https://arxiv.org/pdf/2301.12345v2"],
    ["www subdomain", "https://www.arxiv.org/abs/2301.12345"],
    ["export subdomain", "https://export.arxiv.org/abs/2301.12345"],
    ["no scheme", "arxiv.org/abs/2301.12345"],
    ["bare modern id", "2301.12345"],
    ["bare modern id with version", "2301.12345v2"],
    ["bare legacy id", "hep-th/9901001"],
    ["bare legacy id with subject class", "math.AG/0601001"],
  ];

  const NOT_ARXIV: Array<[label: string, input: string]> = [
    // Regression: `new URL` 只在缺 scheme 时抛错，而这包括任何用户没写
    // https:// 的第三方链接。旧实现的 catch 分支退回裸正则，把下面四行
    // 全判成了 arXiv —— 前两行导入不相干的论文，后两行写入捏造的 source_url。
    [
      "third-party path containing an id-shaped number",
      "example.com/files/2024.12345/paper.pdf",
    ],
    [
      "third-party filename that looks like an id",
      "cdn.host.com/2301.12345.pdf",
    ],
    [
      "third-party path matching the legacy id shape",
      "mysite.com/papers/1234567.pdf",
    ],
    [
      "protocol-relative third-party URL",
      "//cdn.example.com/report/1234567.pdf",
    ],
    // 冒充 arxiv.org 的 host
    [
      "arxiv.org as a label of an attacker domain",
      "https://evil-arxiv.org.attacker.com/2301.12345",
    ],
    [
      "arxiv.org as a prefix of an attacker domain",
      "https://arxiv.org.evil.com/abs/2301.12345",
    ],
    [
      "a domain merely ending in notarxiv.org",
      "https://notarxiv.org/abs/2301.12345",
    ],
    [
      "a real arXiv URL smuggled into the fragment",
      "https://attacker.com/x#https://arxiv.org/abs/2301.12345",
    ],
    // 边界
    ["empty string", ""],
    ["whitespace only", "   "],
  ];

  it.each(ARXIV)("treats %s as arXiv", (_label, input) => {
    expect(isArxivLink(input)).toBe(true);
  });

  it.each(NOT_ARXIV)("does not treat %s as arXiv", (_label, input) => {
    expect(isArxivLink(input)).toBe(false);
  });
});
