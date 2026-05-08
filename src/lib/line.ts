import { messagingApi, validateSignature, WebhookEvent } from '@line/bot-sdk';

const { MessagingApiClient } = messagingApi;

let cachedClient: InstanceType<typeof MessagingApiClient> | null = null;

export function getLineClient(): InstanceType<typeof MessagingApiClient> {
  if (cachedClient) return cachedClient;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN not set');
  cachedClient = new MessagingApiClient({ channelAccessToken: token });
  return cachedClient;
}

/**
 * 驗證 LINE Webhook 的 X-Line-Signature header。
 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.error('[line] LINE_CHANNEL_SECRET not set — refusing webhook');
    return false;
  }
  return validateSignature(rawBody, secret, signature);
}

/**
 * Reply API（用 reply token，必須在 30 秒內呼叫）
 */
export async function replyText(replyToken: string, text: string): Promise<void> {
  const client = getLineClient();
  await client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text }]
  });
}

/**
 * Push API（推給特定 user/group），用於排程廣播
 */
export async function pushText(to: string, text: string): Promise<void> {
  const client = getLineClient();
  await client.pushMessage({
    to,
    messages: [{ type: 'text', text }]
  });
}

/**
 * Broadcast API（推給所有加好友的人，需 verified bot）
 */
export async function broadcastText(text: string): Promise<void> {
  const client = getLineClient();
  await client.broadcast({
    messages: [{ type: 'text', text }]
  });
}

/**
 * 依 LINE_DAILY_PUSH_TARGET 環境變數選擇用 push 還是 broadcast
 */
export async function dailyPush(text: string): Promise<void> {
  const target = process.env.LINE_DAILY_PUSH_TARGET?.trim();
  if (target) {
    await pushText(target, text);
  } else {
    await broadcastText(text);
  }
}

/**
 * 從 webhook event 取出 sourceId（user 或 group 都對應到單一狀態空間）
 */
export function getSourceId(event: WebhookEvent): string | null {
  const src = event.source;
  if (!src) return null;
  if ('groupId' in src && src.groupId) return src.groupId;
  if ('roomId' in src && src.roomId) return src.roomId;
  if ('userId' in src && src.userId) return src.userId;
  return null;
}

export type { WebhookEvent };
