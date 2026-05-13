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
 * 帶指數退避重試的 LINE push（最多 3 次：立即、200ms、800ms）
 * 5xx 才重試；4xx 直接失敗（重試也不會好）
 */
async function pushWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [0, 200, 800];
  let lastErr: unknown;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // 4xx 不重試（auth / 格式錯誤）
      const status = (err as { statusCode?: number; status?: number })?.statusCode
        ?? (err as { statusCode?: number; status?: number })?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        throw err;
      }
      console.warn(`[line] push attempt ${i + 1}/${delays.length} failed:`, err);
    }
  }
  throw lastErr;
}

/**
 * Push API（推給特定 user/group），用於排程廣播 — 內建重試
 */
export async function pushText(to: string, text: string): Promise<void> {
  const client = getLineClient();
  await pushWithRetry(() => client.pushMessage({
    to,
    messages: [{ type: 'text', text }]
  }));
}

/**
 * 推任意 message（文字 / flex 等） — 內建重試
 */
export async function pushMessages(to: string, messages: unknown[]): Promise<void> {
  const client = getLineClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushWithRetry(() => client.pushMessage({ to, messages: messages as any }));
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
