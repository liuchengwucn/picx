import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsMedia } from "#/db/schema";
import type { ImageProbe } from "#/lib/news/image-source";
import { probeNewsImage } from "#/lib/news/image-source";
import { leadImageCandidates, pickLeadImage } from "./news-cron";

vi.mock("#/lib/news/image-source", () => ({
  probeNewsImage: vi.fn(),
}));

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

describe("pickLeadImage", () => {
  const probe = vi.mocked(probeNewsImage);
  /** 按候选顺序给出探活结论 */
  function verdicts(map: Record<string, ImageProbe>) {
    probe.mockImplementation(async (url: string) => map[url] ?? "rejected");
  }

  beforeEach(() => {
    probe.mockReset();
  });

  it("取第一张 ok，且命中即停（不白探后面的）", async () => {
    verdicts({
      "https://a.example/1.jpg": "rejected",
      "https://a.example/2.jpg": "ok",
      "https://a.example/3.jpg": "ok",
    });
    const picked = await pickLeadImage([
      {
        media: [
          img("https://a.example/1.jpg"),
          img("https://a.example/2.jpg"),
          img("https://a.example/3.jpg"),
        ],
      },
    ]);
    expect(picked?.url).toBe("https://a.example/2.jpg");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("候选全是 rejected（防盗链 403 等明确拒绝）才存 null", async () => {
    verdicts({});
    const picked = await pickLeadImage([
      {
        media: [img("https://a.example/1.jpg"), img("https://a.example/2.jpg")],
      },
    ]);
    expect(picked).toBeNull();
  });

  // fail-open：workerd 连不上 ≠ 浏览器加载不了（缺中间证书的站点实测如此），
  // 而误存 NULL 是不可逆的净损失，误存坏图则被前端 StoryImage 兜住。
  it("没有 ok 但有 unreachable 时，采用第一个 unreachable 而不是 null", async () => {
    verdicts({
      "https://a.example/1.jpg": "rejected",
      "https://a.example/2.jpg": "unreachable",
      "https://a.example/3.jpg": "unreachable",
    });
    const picked = await pickLeadImage([
      {
        media: [
          img("https://a.example/1.jpg"),
          img("https://a.example/2.jpg"),
          img("https://a.example/3.jpg"),
        ],
      },
    ]);
    expect(picked?.url).toBe("https://a.example/2.jpg");
  });

  it("ok 优先于更靠前的 unreachable", async () => {
    verdicts({
      "https://a.example/1.jpg": "unreachable",
      "https://a.example/2.jpg": "ok",
    });
    const picked = await pickLeadImage([
      {
        media: [img("https://a.example/1.jpg"), img("https://a.example/2.jpg")],
      },
    ]);
    expect(picked?.url).toBe("https://a.example/2.jpg");
  });

  it("没有候选时不探活，直接 null", async () => {
    const picked = await pickLeadImage([{ media: null }]);
    expect(picked).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });
});
