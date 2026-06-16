/**
 * /api/notification-settings 的 zod schema + upsert payload builder。
 *
 * 抽到獨立檔案的原因（跟 subscriptions/schema.ts 同模式）：
 *   - Next.js App Router 的 route.ts 只允許 export 特定名稱（GET/POST/...）；
 *     多 export 一個 helper 會讓 next build 的型別檢查炸掉。
 *   - 純資料層輯獨立 → 可單測。
 */
import { z } from 'zod';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const PostBody = z.object({
  sourceId: z.string().min(1),
  // 全部設定欄位都 optional — 支援「只改一個欄位」的局部更新。
  // 之前 quiet 是必填 → 任何想只改 dailySummary 的呼叫端要嘛 400、要嘛被迫
  // 重送 quiet（漏送就把使用者的靜音時段洗成 null）。改 optional 後：
  // undefined = 不動該欄位、null = 明確清掉、有值 = 寫值。
  quietStart: z.string().regex(TIME_RE).nullable().optional(),
  quietEnd: z.string().regex(TIME_RE).nullable().optional(),
  timezone: z.string().optional(),
  dailySummary: z.boolean().optional(),
  priceAlerts: z.boolean().optional(),
  // PR #4b 新增：群組情境下，新追蹤的預設通知對象 ('me' = 個人 / 'group' = 群組)
  // 對應 migration 0008。'me' 預設不會誤打擾群組。
  defaultNotifyTarget: z.enum(['me', 'group']).optional()
});

export type PostBodyInput = z.infer<typeof PostBody>;

/**
 * 把 POST body 轉成 upsert payload — undefined 欄位不出現（不動現值）。
 * upsert on-conflict 只更新 payload 內的欄位，所以局部更新不會洗掉沒送的欄位。
 */
export function buildSettingsUpsert(body: PostBodyInput): Record<string, unknown> {
  const row: Record<string, unknown> = {
    source_id: body.sourceId,
    updated_at: new Date().toISOString()
  };
  if (body.quietStart !== undefined) row.quiet_start = body.quietStart;
  if (body.quietEnd !== undefined) row.quiet_end = body.quietEnd;
  if (body.timezone !== undefined) row.timezone = body.timezone;
  if (body.dailySummary !== undefined) row.daily_summary = body.dailySummary;
  if (body.priceAlerts !== undefined) row.price_alerts = body.priceAlerts;
  if (body.defaultNotifyTarget !== undefined) row.default_notify_target = body.defaultNotifyTarget;
  return row;
}
