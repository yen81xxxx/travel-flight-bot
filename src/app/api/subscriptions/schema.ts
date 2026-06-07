/**
 * /api/subscriptions PATCH endpoint 的 zod schema + payload builder。
 *
 * 抽到獨立檔案的原因：
 *   - route.ts 用 next/server 的 Request / NextResponse，會把 Next.js
 *     server runtime 拉進 jest jsdom 環境造成 "Request is not defined"
 *   - 純資料層輯獨立 → 可單獨單測 → 改 schema 時不會炸 endpoint
 */
import { z } from 'zod';

// 'HH:MM' 24h 格式
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * PATCH /api/subscriptions body schema。
 * 規則：
 *   - id + sourceId 必填
 *   - 其他欄位 optional（不給 = 不動）
 *   - null 表「清掉」既有值（例如 maxPriceTraditional null = 改回跟隨主目標）
 *   - 時段 4 個欄位各自 'HH:MM' 或 null（min/max 跨段一致性檢查在 LIFF 端做）
 */
export const PatchBody = z.object({
  id: z.number(),
  sourceId: z.string(),
  paused: z.boolean().optional(),
  label: z.string().nullable().optional(),
  maxPrice: z.number().positive().optional(),
  // null 表示清掉「傳統另設」，回到跟隨 max_price
  maxPriceTraditional: z.number().positive().nullable().optional(),
  // 起飛時段窗口 'HH:MM'；null 表該端不限
  outboundMinDepartureTime: z.string().regex(HHMM_RE).nullable().optional(),
  returnMinDepartureTime: z.string().regex(HHMM_RE).nullable().optional(),
  outboundMaxDepartureTime: z.string().regex(HHMM_RE).nullable().optional(),
  returnMaxDepartureTime: z.string().regex(HHMM_RE).nullable().optional()
});

export type PatchBodyInput = z.infer<typeof PatchBody>;

/**
 * 把 PATCH body 轉成 supabase update payload。
 * undefined → 該欄位不出現在 payload（不動資料庫現值）；
 * null → 該欄位寫 null（清掉設定）；
 * 有值 → 寫值。
 */
export function buildPatchUpdatePayload(body: PatchBodyInput): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (body.paused !== undefined) update.paused = body.paused;
  if (body.label !== undefined) update.label = body.label;
  if (body.maxPrice !== undefined) update.max_price = body.maxPrice;
  if (body.maxPriceTraditional !== undefined) update.max_price_traditional = body.maxPriceTraditional;
  if (body.outboundMinDepartureTime !== undefined) update.outbound_min_departure_time = body.outboundMinDepartureTime;
  if (body.returnMinDepartureTime !== undefined) update.return_min_departure_time = body.returnMinDepartureTime;
  if (body.outboundMaxDepartureTime !== undefined) update.outbound_max_departure_time = body.outboundMaxDepartureTime;
  if (body.returnMaxDepartureTime !== undefined) update.return_max_departure_time = body.returnMaxDepartureTime;
  return update;
}
