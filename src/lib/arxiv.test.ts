import { describe, expect, it } from "vitest";
import { canonicalArxivId, isArxivLink, LEGACY_ARCHIVES } from "./arxiv";

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
    // 白名单收紧后仍须保住大小写宽容：学科类后缀小写写法是合法输入。
    ["bare legacy id with lowercase subject class", "math.ag/0601001"],
    // 已停用的历史 archive: 白名单若只收现役 archive, 这类存量 id 会被误判成
    // 普通链接, 进而以 bad_url 报错而不是导入。
    ["bare retired-archive id", "alg-geom/9601001"],
    ["bare retired-archive id with version", "q-alg/9601001v2"],
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
    // Regression: 旧格式 archive 段曾写作 `[a-z-]+`，而两字母学科类后缀
    // （math.AG）与两字母 ccTLD（.me/.ly/.be）形状一致，于是短链被判成 arXiv，
    // 导入一篇不存在的论文并写入捏造的 source_url。现已收紧为 archive 白名单。
    ["a ccTLD short link shaped like a legacy id", "t.me/1234567"],
    ["another ccTLD short link", "bit.ly/1234567"],
    ["a bare path segment shaped like a legacy id", "foo/1234567"],
    // archive 白名单挡不住首段恰好是 archive 名的域名（`cs` + ccTLD `.ly`）——
    // 正则带 /i，学科类后缀 `[A-Z]{2}` 同时也匹配小写 ccTLD。真正堵死这一类的是
    // 旧格式数字段的月份校验：1234567 的 MM=34 不合法。
    ["an archive-named domain with a ccTLD", "cs.ly/1234567"],
    ["another archive-named domain with a ccTLD", "math.io/1234567"],
    ["a third archive-named domain with a ccTLD", "stat.us/1234567"],
    // 月份校验的边界：00 与 13 都不是合法月份。
    ["a legacy id with month 00", "hep-th/9600001"],
    ["a legacy id with month 13", "hep-th/9613001"],
    // userinfo 绕过：`@` 前的部分是用户名而非 host。靠 URL 语义挡住，
    // 钉死以防未来有人把 host 判定换回字符串匹配。
    [
      "arxiv.org smuggled into the userinfo",
      "https://arxiv.org@evil.com/2301.12345",
    ],
    // 边界
    ["empty string", ""],
    ["whitespace only", "   "],
    // 新格式 id 的小数部分上限是 5 位，6 位不是 arXiv id。
    ["a six-digit modern id", "2301.123456"],
    // 两次 new URL 都抛错的兜底分支：空串守卫拦不住这些，只有它们能走到那里。
    ["an unparseable bare percent sign", "%"],
    ["an unparseable bracket", "["],
  ];

  it.each(ARXIV)("treats %s as arXiv", (_label, input) => {
    expect(isArxivLink(input)).toBe(true);
  });

  it.each(NOT_ARXIV)("does not treat %s as arXiv", (_label, input) => {
    expect(isArxivLink(input)).toBe(false);
  });

  // 裸 id 分支不经 host 校验，全靠 canonicalArxivId 兜底：一旦白名单里出现
  // canonicalArxivId 的 `[a-z-]+` 不接受的字符（数字、点、下划线），isArxivLink
  // 会判 true 而 canonicalArxivUrl 原样返回输入，撞上 paper.create 的
  // z.string().url()。同时这也钉住「白名单里没有匹配不到任何输入的死项」。
  it.each(LEGACY_ARCHIVES.map((archive) => [archive] as const))(
    "keeps the bare-id branch and canonicalArxivId in sync for %s",
    (archive) => {
      const id = `${archive}/9601001`;
      expect(isArxivLink(id)).toBe(true);
      expect(canonicalArxivId(id)).toBe(id);
    },
  );
});
