import { describe, expect, it } from "vitest";
import type { NewsMedia } from "#/db/schema";
import { leadImageCandidates } from "./news-cron";

const img = (url: string): NewsMedia => ({ type: "image", url });
const urls = (list: NewsMedia[]) => list.map((m) => m.url);

describe("leadImageCandidates", () => {
  it("按成员顺序摊平 media，保持原顺序", () => {
    const members = [
      {
        media: [img("https://a.example/1.jpg"), img("https://a.example/2.jpg")],
      },
      { media: [img("https://b.example/3.jpg")] },
    ];
    expect(urls(leadImageCandidates(members))).toEqual([
      "https://a.example/1.jpg",
      "https://a.example/2.jpg",
      "https://b.example/3.jpg",
    ]);
  });

  it("过滤 video、非 https 与 logo/头像类垃圾 URL", () => {
    const members = [
      {
        media: [
          { type: "video", url: "https://a.example/v.mp4" } as NewsMedia,
          img("http://a.example/insecure.jpg"),
          img("https://a.example/logo.png"),
          img("https://a.example/head.jpg"),
          img("https://a.example/favicon.ico"),
          img("https://a.example/avatar/u1.jpg"),
          img("https://a.example/real.jpg"),
        ],
      },
    ];
    expect(urls(leadImageCandidates(members))).toEqual([
      "https://a.example/real.jpg",
    ]);
  });

  it("同一 URL 在多个成员里重复出现时只保留一次（转载源常见，否则白探）", () => {
    const members = [
      { media: [img("https://a.example/1.jpg")] },
      {
        media: [img("https://a.example/1.jpg"), img("https://b.example/2.jpg")],
      },
      { media: [img("https://a.example/1.jpg")] },
    ];
    expect(urls(leadImageCandidates(members))).toEqual([
      "https://a.example/1.jpg",
      "https://b.example/2.jpg",
    ]);
  });

  it("最多返回 4 张（探活 subrequest 预算）", () => {
    const members = [
      {
        media: Array.from({ length: 9 }, (_, i) =>
          img(`https://a.example/${i}.jpg`),
        ),
      },
    ];
    expect(urls(leadImageCandidates(members))).toEqual([
      "https://a.example/0.jpg",
      "https://a.example/1.jpg",
      "https://a.example/2.jpg",
      "https://a.example/3.jpg",
    ]);
  });

  it("去重发生在截断之前：重复项不占用 4 个名额", () => {
    const dup = img("https://a.example/dup.jpg");
    const members = [
      { media: [dup, dup, dup, dup, img("https://a.example/x.jpg")] },
    ];
    expect(urls(leadImageCandidates(members))).toEqual([
      "https://a.example/dup.jpg",
      "https://a.example/x.jpg",
    ]);
  });

  it("成员没有 media（null）时返回空列表", () => {
    expect(leadImageCandidates([{ media: null }, { media: [] }])).toEqual([]);
  });
});
