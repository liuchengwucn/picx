export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

/**
 * 通过 Telegram Bot API 发一条带图消息：图为 photoUrl（Telegram 服务端自行拉取），
 * caption 为可直接复制的推文文案。失败抛错（含 Telegram 的 description）。
 * caption 上限 1024 字符，我们的文案 ≤280，无需裁剪。
 */
export async function sendPhoto(
  creds: TelegramCredentials,
  photoUrl: string,
  caption: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${creds.botToken}/sendPhoto`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: creds.chatId,
      photo: photoUrl,
      caption,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { ok?: boolean; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram API not ok: ${data.description ?? "unknown"}`);
  }
}

/**
 * 通过 Telegram Bot API 发一条纯文本消息（无图）。用于没有配图可发的告警场景。
 * 失败抛错（含 Telegram 的 description）。
 */
export async function sendMessage(
  creds: TelegramCredentials,
  text: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${creds.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: creds.chatId, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { ok?: boolean; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram API not ok: ${data.description ?? "unknown"}`);
  }
}
