// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { overwriteGetLocale } from "#/paraglide/runtime";
import {
  WhiteboardQuotaHint,
  type WhiteboardQuotaHintProps,
} from "./whiteboard-quota-hint";

beforeAll(() => {
  // Node 22 压掉 jsdom 的 localStorage，paraglide 的 getLocale 会炸；固定 en 旁路
  overwriteGetLocale(() => "en");
});
afterEach(cleanup);

function renderHint(props: WhiteboardQuotaHintProps) {
  // 包一层带 testid 的空壳：它挂上了就说明路由已经渲染完根组件，
  // 「加载中什么都不渲染」那条断言才不会与「还没开始渲染」混为一谈。
  const rootRoute = createRootRoute({
    component: () => (
      <div data-testid="hint-slot">
        <WhiteboardQuotaHint {...props} />
      </div>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router as never} />);
}

describe("WhiteboardQuotaHint", () => {
  it("says the image is free with the user's own API", async () => {
    renderHint({ remaining: 0, apiSource: "user", hasApiConfigs: true });
    expect(await screen.findByText(/your own API/)).toBeTruthy();
  });

  it("shows the remaining count on the site API", async () => {
    renderHint({ remaining: 7, apiSource: "system", hasApiConfigs: false });
    expect(await screen.findByText("7 more can be generated")).toBeTruthy();
  });

  it("offers a one-click switch when exhausted and configs exist", async () => {
    const onUseOwnApi = vi.fn();
    renderHint({
      remaining: 0,
      apiSource: "system",
      hasApiConfigs: true,
      onUseOwnApi,
    });
    const button = await screen.findByRole("button", { name: "Use my API" });
    button.click();
    expect(onUseOwnApi).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/used up/)).toBeTruthy();
  });

  it("links to settings when exhausted and nothing is configured", async () => {
    renderHint({ remaining: 0, apiSource: "system", hasApiConfigs: false });
    const link = await screen.findByRole("link", { name: "Set up my API" });
    expect(link.getAttribute("href")).toBe("/settings/providers");
  });

  it("stays silent while the allowance is still loading", async () => {
    // remaining=0 只是「还没查到」的占位值。这一条钉的就是：加载中绝不能
    // 说出「用完了」——那是把未知当成了坏消息。
    renderHint({
      remaining: 0,
      apiSource: "system",
      hasApiConfigs: false,
      loading: true,
    });
    // 先等路由把根组件挂上，否则「没渲染出文案」可能只是还没开始渲染
    await screen.findByTestId("hint-slot");
    expect(screen.queryByText(/used up/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).not.toContain("Set up my API");
  });

  it("never mentions credits", async () => {
    renderHint({ remaining: 3, apiSource: "system", hasApiConfigs: false });
    await screen.findByText(/generated/);
    expect(document.body.textContent?.toLowerCase()).not.toContain("credit");
  });
});
