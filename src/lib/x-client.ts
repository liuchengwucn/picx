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

/** 发一条纯文本推。失败抛错（含状态码与响应体）。 */
export async function postTweet(
  text: string,
  creds: XCredentials,
): Promise<PostTweetResult> {
  const url = "https://api.twitter.com/2/tweets";
  const auth = await buildAuthHeader("POST", url, creds);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
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
