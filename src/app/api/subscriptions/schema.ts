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
  returnMaxDepartureTime: z.string().regex(HHMM_RE).nullable().optional(),
  // 日期：YYYY-MM-DD；returnDate 給 null 表單程訂閱
  outboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // 航司過濾（0012）：displayName 陣列；給 [] 或 null 表清掉過濾（追全部）
  airlineFilter: z.array(z.string()).nullable().optional()
});

export type PatchBodyInput = z.infer<typeof PatchBody>;

/**
 * 把 PATCH body 轉成 supabase update payload。
 * undefined → 該欄位不出現在 payload（不動資料庫現值）；
 * null → 該欄位寫 null（清掉設定）；
 * 有值 → 寫值。
 */
/**
 * 把 Supabase update/delete 的 `.select('id')` 結果轉成 HTTP 回應語意。
 *
 * 為什麼需要：Supabase 對「filter 沒 match 到任何列」回 `error: null` +
 * `data: []` — 不是 error。沒有這個檢查，PATCH/DELETE 會在 id/source_id 對
 * 不上時回假成功（使用者看到「已取消 / 已儲存」但資料庫沒動）。這正是
 * 回報的 bug：取消訂閱顯示成功但實際沒作用。
 *
 * 純函數方便單測（route.ts 用 next/server 跑 jest 會炸）。
 */
export function mutationResult(
  data: { id: number }[] | null,
  error: { message: string } | null
): { ok: true } | { ok: false; status: number; error: string } {
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, status: 404, error: '找不到這筆訂閱（可能已被移除或無權限）' };
  }
  return { ok: true };
}

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
  if (body.outboundDate !== undefined) update.outbound_date = body.outboundDate;
  // returnDate: null → 寫 null（變單程）；'YYYY-MM-DD' → 寫新日期；undefined → 不動
  if (body.returnDate !== undefined) update.return_date = body.returnDate;
  // airlineFilter: 空陣列 / null → 寫 null（清掉過濾、追全部）；有值 → 寫；undefined → 不動
  if (body.airlineFilter !== undefined) {
    update.airline_filter = body.airlineFilter && body.airlineFilter.length > 0 ? body.airlineFilter : null;
  }
  return update;
}
