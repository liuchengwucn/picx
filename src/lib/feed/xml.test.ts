import { describe, expect, it } from "vitest";
import { stripInvalidXmlChars, xmlText } from "./xml";

// 控制字符一律写 \uXXXX 转义形式，不要写字面量：字面量在编辑器与剪贴板里不可见，
// 复制时会静默丢失，测试就变成了「什么都没测」。
describe("stripInvalidXmlChars", () => {
  it("保留合法的空白控制字符", () => {
    expect(stripInvalidXmlChars("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("剥掉 C0 控制字符", () => {
    expect(stripInvalidXmlChars("w\u0001xyz")).toBe("wxyz");
  });

  it("剥掉未配对代理项，保留配对的 emoji", () => {
    expect(stripInvalidXmlChars("a\ud800b")).toBe("ab");
    expect(stripInvalidXmlChars("hi \u{1F389}")).toBe("hi \u{1F389}");
  });

  it("保留 U+FFFD（它是合法 XML 字符，不该被误剥）", () => {
    expect(stripInvalidXmlChars("a�b")).toBe("a�b");
  });
});

describe("xmlText", () => {
  it("转义 XML 预定义实体", () => {
    expect(xmlText(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });

  it("先剥非法字符再转义", () => {
    expect(xmlText("w\u0001<xyz")).toBe("w&lt;xyz");
  });
});
