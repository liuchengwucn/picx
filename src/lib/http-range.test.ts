import { describe, expect, it } from "vitest";
import { parseRangeHeader, servedRange, toR2Range } from "./http-range";

describe("parseRangeHeader", () => {
  it("没有 Range 头时返回 none", () => {
    expect(parseRangeHeader(null)).toEqual({ kind: "none" });
  });

  it("解析闭区间", () => {
    expect(parseRangeHeader("bytes=0-99")).toEqual({
      kind: "offset",
      offset: 0,
      length: 100,
    });
  });

  it("解析开区间（到末尾）", () => {
    expect(parseRangeHeader("bytes=100-")).toEqual({
      kind: "offset",
      offset: 100,
    });
  });

  it("解析后缀区间", () => {
    expect(parseRangeHeader("bytes=-500")).toEqual({
      kind: "suffix",
      suffix: 500,
    });
  });

  it("单字节区间的长度是 1，不是 0", () => {
    expect(parseRangeHeader("bytes=5-5")).toEqual({
      kind: "offset",
      offset: 5,
      length: 1,
    });
  });

  it("容忍首尾空白", () => {
    expect(parseRangeHeader("  bytes=0-9  ")).toEqual({
      kind: "offset",
      offset: 0,
      length: 10,
    });
  });

  it("空字符串等同于没有 Range 头", () => {
    expect(parseRangeHeader("")).toEqual({ kind: "none" });
  });

  it("range unit 大小写不敏感", () => {
    expect(parseRangeHeader("Bytes=0-9")).toEqual({
      kind: "offset",
      offset: 0,
      length: 10,
    });
  });

  it("前导零不影响解析", () => {
    // 加 Number.isSafeInteger 守卫后这条必须继续成立
    expect(parseRangeHeader("bytes=000000000000000000000000005-9")).toEqual({
      kind: "offset",
      offset: 5,
      length: 5,
    });
  });

  it.each([
    ["bytes=-", "两端都空"],
    ["bytes=-0", "后缀为 0"],
    ["bytes=10-5", "结束早于开始"],
    ["bytes=0-9,20-29", "多区间"],
    ["items=0-9", "非 bytes 单位"],
    ["0-9", "缺单位前缀"],
    ["bytes=abc", "非数字"],
    ["bytes=", "只有单位没有区间"],
    // 溢出值传到 R2 会在 C++ 层被强转成 0，于是「从 1e20 开始」变成一个宣称
    // bytes 0-35/36 的 206——服务端说了谎。必须在解析层就拦掉。
    ["bytes=99999999999999999999-", "起点溢出"],
    ["bytes=0-99999999999999999999", "终点溢出"],
    ["bytes=-99999999999999999999", "后缀溢出"],
  ])("拒绝非法输入 %s（%s）", (header) => {
    expect(parseRangeHeader(header)).toEqual({ kind: "invalid" });
  });
});

describe("toR2Range", () => {
  it("none / invalid 都不带区间", () => {
    expect(toR2Range({ kind: "none" })).toBeUndefined();
    expect(toR2Range({ kind: "invalid" })).toBeUndefined();
  });

  it("带长度的 offset 区间原样传递", () => {
    expect(toR2Range({ kind: "offset", offset: 100, length: 50 })).toEqual({
      offset: 100,
      length: 50,
    });
  });

  it("不带长度的 offset 区间不能凭空补出 length", () => {
    // 补了就等于把「到末尾」写死成某个长度
    expect(toR2Range({ kind: "offset", offset: 100 })).toEqual({ offset: 100 });
  });

  it("suffix 区间原样交给 R2 换算", () => {
    expect(toR2Range({ kind: "suffix", suffix: 500 })).toEqual({ suffix: 500 });
  });
});

describe("servedRange", () => {
  it("收窄 workerd 实际回填的形状（三个键都在，多余的是 undefined）", () => {
    // 这正是 `"suffix" in range` 恒为真的那个坑
    const workerdShape = {
      offset: 0,
      length: 10,
      suffix: undefined,
    } as R2Range;
    expect(servedRange(workerdShape)).toEqual({ offset: 0, length: 10 });
  });

  it("offset 为 0 的首个分片不能被当成缺失", () => {
    expect(servedRange({ offset: 0, length: 65536 })).toEqual({
      offset: 0,
      length: 65536,
    });
  });

  it("没读到区间信息就返回 undefined", () => {
    expect(servedRange(undefined)).toBeUndefined();
    expect(servedRange({ suffix: 5 })).toBeUndefined();
    expect(servedRange({ offset: 10 })).toBeUndefined();
  });
});
