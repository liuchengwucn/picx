/**
 * IndexNow —— 论文转为公开/上架画廊时, 主动通知 Bing/IndexNow 协议方
 * (驱动 Copilot、DuckDuckGo、Yahoo 的 AI 搜索) 几分钟内抓取新页面。
 *
 * key 文件固定挂在 /indexnow-key.txt (见同名路由), 提交时用 keyLocation 指过去,
 * 无需把 key 拼进文件名。
 */

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";

export interface IndexNowBody {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export function buildIndexNowSubmission(input: {
  siteUrl: string;
  key: string;
  urls: string[];
}): { endpoint: string; body: IndexNowBody } {
  return {
    endpoint: INDEXNOW_ENDPOINT,
    body: {
      host: new URL(input.siteUrl).host,
      key: input.key,
      keyLocation: `${input.siteUrl}${INDEXNOW_KEY_PATH}`,
      urlList: input.urls,
    },
  };
}

/**
 * 发起一次 IndexNow 提交。fire-and-forget: 任何失败都吞掉, 绝不影响主流程
 * (分享/上架画廊)。key 未配置时直接跳过。
 */
export async function submitIndexNow(input: {
  siteUrl: string;
  key: string | undefined | null;
  urls: string[];
}): Promise<void> {
  if (!input.key || input.urls.length === 0) return;
  try {
    const { endpoint, body } = buildIndexNowSubmission({
      siteUrl: input.siteUrl,
      key: input.key,
      urls: input.urls,
    });
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("IndexNow submission failed:", error);
  }
}
