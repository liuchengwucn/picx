// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { StoryImage } from "./story-image";

// 命中 image-source 防盗链白名单，应改走 /api/news-image 代理
const HOTLINK_URL = "https://i.qbitai.com/2026/08/cover.jpg";
const PLAIN_URL = "https://example.com/cover.jpg";
const OTHER_URL = "https://example.com/another.jpg";

/**
 * 把 `<img>` 的加载结果伪造成浏览器里的某个终态再跑 `run()`。
 *
 * 必须伪造是因为 jsdom 默认不取任何外部资源：挂了 src 的 img 会永远停在
 * `complete === false`（实测 jsdom 27，无论是否插入文档），也就是「还在加载」，
 * 挂载补检因此不会触发。真实浏览器里一张**已经加载失败**的图是
 * `complete === true && naturalWidth === 0`——这正是首屏 SSR 图在 hydration
 * 之前就失败后 DOM 的样子，也是本组件要识别的唯一信号。
 */
function withImageState(
  state: { complete: boolean; naturalWidth: number },
  run: () => void,
) {
  const saved = (["complete", "naturalWidth"] as const).map(
    (key) =>
      [
        key,
        Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, key),
      ] as const,
  );
  for (const [key, value] of Object.entries(state)) {
    Object.defineProperty(HTMLImageElement.prototype, key, {
      configurable: true,
      get: () => value,
    });
  }
  try {
    run();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) {
        Object.defineProperty(HTMLImageElement.prototype, key, descriptor);
      }
    }
  }
}

afterEach(cleanup);

describe("StoryImage", () => {
  it("挂载补检：加载已结束却没有像素的图直接不渲染", () => {
    withImageState({ complete: true, naturalWidth: 0 }, () => {
      const { container } = render(
        <StoryImage media={{ type: "image", url: PLAIN_URL }} />,
      );

      // 没挂过 onError 也要摘掉——这就是「error 事件早于 hydration 而永久丢失」那条路径
      expect(container.querySelector("img")).toBeNull();
      // 不是 display:none：元素连同它的外边距一起消失，版面不留空隙
      expect(container.innerHTML).toBe("");
    });
  });

  it("hydrateRoot：SSR 直出的坏图在 hydration 时被摘掉，且不算 hydration mismatch", () => {
    withImageState({ complete: true, naturalWidth: 0 }, () => {
      const media = { type: "image", url: PLAIN_URL } as const;
      // 复刻 bug 现场：img 由服务端直出，浏览器早在 bundle 到达前就开始加载它，
      // 失败得比 hydration 早 ⇒ onError 永远听不到。RTL 的 render() 走的是
      // createRoot，钉不住这条路径。
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(<StoryImage media={media} />);
      document.body.appendChild(container);
      expect(container.querySelector("img")).not.toBeNull();

      const recoverable: unknown[] = [];
      let root: ReturnType<typeof hydrateRoot> | undefined;
      act(() => {
        root = hydrateRoot(container, <StoryImage media={media} />, {
          onRecoverableError: (error) => recoverable.push(error),
        });
      });

      expect(container.querySelector("img")).toBeNull();
      // 首帧与 SSR 一致、失败态是 hydration 之后才设的，不该触发任何可恢复错误
      expect(recoverable).toEqual([]);

      act(() => root?.unmount());
      container.remove();
    });
  });

  it("挂载补检不误伤已经加载好的图（如命中缓存的图）", () => {
    withImageState({ complete: true, naturalWidth: 640 }, () => {
      const { container } = render(
        <StoryImage media={{ type: "image", url: PLAIN_URL }} />,
      );
      expect(container.querySelector("img")).not.toBeNull();
    });
  });

  // 以下用例都跑在 jsdom 默认的「加载中」状态（complete === false），补检不介入
  it("onError 兜住挂载之后才失败的图", () => {
    const { container } = render(
      <StoryImage media={{ type: "image", url: PLAIN_URL }} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();

    fireEvent.error(img as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
  });

  it("换 url 时失败态自愈，调用方不必挂 key", () => {
    const { container, rerender } = render(
      <StoryImage media={{ type: "image", url: PLAIN_URL }} />,
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();

    // 复用同一个组件实例换图。做成裸布尔 + 靠调用方 key 的话，这里会静默地永远不显示
    rerender(<StoryImage media={{ type: "image", url: OTHER_URL }} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(OTHER_URL);

    // 切回曾经失败过的那张：失败记忆已在换图时作废，要重新给它一次机会
    // （瞬时失败不该被永久记住；换 key 重挂载的老写法本来也会重试）
    rerender(<StoryImage media={{ type: "image", url: PLAIN_URL }} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(PLAIN_URL);
  });

  it("非 image 类型（如 video）不渲染", () => {
    const { container } = render(
      <StoryImage media={{ type: "video", url: PLAIN_URL }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("白名单主机改走代理，且不再加 referrerPolicy（同源请求，加了没意义）", () => {
    const { container } = render(
      <StoryImage media={{ type: "image", url: HOTLINK_URL }} />,
    );
    const img = container.querySelector("img");

    expect(img?.getAttribute("src")).toBe(
      `/api/news-image?u=${encodeURIComponent(HOTLINK_URL)}`,
    );
    expect(img?.hasAttribute("referrerpolicy")).toBe(false);
  });

  it("非白名单主机直连并带 no-referrer（微信图床带 Referer 会回占位图）", () => {
    const { container } = render(
      <StoryImage
        media={{ type: "image", url: PLAIN_URL, width: 800, height: 450 }}
      />,
    );
    const img = container.querySelector("img");

    expect(img?.getAttribute("src")).toBe(PLAIN_URL);
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    // width/height 透传，给浏览器一个固有宽高比占位
    expect(img?.getAttribute("width")).toBe("800");
    expect(img?.getAttribute("height")).toBe("450");
  });

  it("eager 控制 loading 属性", () => {
    const eager = render(
      <StoryImage media={{ type: "image", url: PLAIN_URL }} eager />,
    );
    expect(eager.container.querySelector("img")?.getAttribute("loading")).toBe(
      "eager",
    );
    cleanup();

    const lazy = render(
      <StoryImage media={{ type: "image", url: PLAIN_URL }} />,
    );
    expect(lazy.container.querySelector("img")?.getAttribute("loading")).toBe(
      "lazy",
    );
  });
});
