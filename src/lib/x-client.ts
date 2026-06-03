export interface XCredentials {
  apiKey: string; // consumer key
  apiSecret: string; // consumer secret
  accessToken: string;
  accessSecret: string;
}

/** RFC 3986 百分号编码（OAuth 1.0a 要求）。 */
export function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Base64(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
  let binary = "";
  const bytes = new Uint8Array(sig);
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function buildAuthHeader(
  method: string,
  url: string,
  creds: XCredentials,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // 签名基串：JSON body 不参与，只用 oauth 参数（本请求无 query 参数）。
  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(
    creds.accessSecret,
  )}`;

  const signature = await hmacSha1Base64(signingKey, baseString);
  const headerParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };

  return (
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
      .join(", ")
  );
}

export interface PostTweetResult {
  tweetId: string;
}

/** 上传图片到 X，返回 media_id_string。仅支持 ≤5MB 的静态图片。 */
export async function uploadMedia(
  imageData: Uint8Array,
  creds: XCredentials,
): Promise<string> {
  const url = "https://upload.twitter.com/1.1/media/upload.json";
  const auth = await buildAuthHeader("POST", url, creds);

  let binary = "";
  for (const b of imageData) binary += String.fromCharCode(b);
  const base64 = btoa(binary);

  const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, "")}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="media_data"\r\n\r\n` +
    `${base64}\r\n` +
    `--${boundary}--\r\n`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const resBody = await res.text();
    throw new Error(`X Media Upload ${res.status}: ${resBody}`);
  }

  const data = (await res.json()) as { media_id_string?: string };
  if (!data.media_id_string) {
    throw new Error(
      `X Media Upload ok but no media_id: ${JSON.stringify(data)}`,
    );
  }
  return data.media_id_string;
}

/** 发推。可选附带已上传的媒体。失败抛错（含状态码与响应体）。 */
export async function postTweet(
  text: string,
  creds: XCredentials,
  mediaIds?: string[],
): Promise<PostTweetResult> {
  const url = "https://api.twitter.com/2/tweets";
  const auth = await buildAuthHeader("POST", url, creds);

  const body: Record<string, unknown> = { text };
  if (mediaIds?.length) {
    body.media = { media_ids: mediaIds };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { data?: { id?: string } };
  const tweetId = data.data?.id;
  if (!tweetId) {
    throw new Error(`X API ok but no tweet id: ${JSON.stringify(data)}`);
  }
  return { tweetId };
}
