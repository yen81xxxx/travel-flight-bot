/**
 * LIFF 前端共用 types — Vision watchlist (PR #2~#4 用)
 *
 * 對應 design_handoff_travl_vision/API_CONTRACT.md。
 * 跟既有的 `src/types/Subscription` 共存：API server 端 snake_case，
 * watchlist UI 跟著 API 走（不在前端 alias 成 camelCase，避免雙命名混淆）。
 *
 * Quote 的所有子欄位都可選 — frontend 必須 graceful degrade（手冊規定）：
 *   - quote === null              → 隱藏「目前最低」、sparkline、delta；showSignal=watching
 *   - quote.history 空            → 不 render Sparkline / PriceChart
 *   - quote.deltaPct == null      → 隱藏 delta chip
 *   - quote.trad == null          → 詳細頁只顯示 LCC card
 */

/** 30/90 天歷史點，d 是 'M/D' 短標籤、p 是 NT$ */
export interface PricePoint {
  d: string;
  p: number;
}

/** 訂閱當前報價（同 API_CONTRACT.md `WatchQuote`）*/
export interface WatchQuote {
  /** 當前最低（廉航 vs 傳統哪個贏），NT$ — 必填 */
  currentBest: number;
  /** 贏出的分類 */
  currentType: 'lcc' | 'trad';
  /** 廉航最低 — 可能跨機場 + 混搭航司 */
  lcc: {
    price: number;
    /** 去程航司 */
    out: string;
    /** 回程航司，單程訂閱 null */
    ret: string | null;
    /** 去 ≠ 回 時為 true（去程價格是估算） */
    estimate: boolean;
  } | null;
  /** 傳統航空最低 — 同家來回 */
  trad: {
    price: number;
    airline: string;
  } | null;
  /** vs 7 天前最低，% — 負數=便宜了。沒前一週資料 → null（前端藏 delta chip） */
  deltaPct: number | null;
  /** 升冪日期，最後一筆 == currentBest。空陣列 → 前端不畫圖 */
  history: PricePoint[];
  /**
   * PR #5: Price Intelligence — server 算好的「買 / 等」判斷。
   * 包含 verdict + percentile + p25/p75 + reasons + confidence。
   * 歷史不足時 status='building'，**不**含 verdict。
   * 缺欄位（很舊的訂閱、quote fallback、PR #5 上線前的 client）→ 前端降級不畫 Intel panel。
   * 用 optional 而不是 required null 是因為這個欄位 PR #5 才出現，舊測試 fixture 沒有，
   * 沒必要為了 backward-compat 強行寫 null。
   */
  intel?: PriceIntel | null;
}

// PriceIntel 來自 priceIntel 模組，先 import 才能在 WatchQuote 內用，
// 再 re-export 讓 caller 從這支拿一致的 type。
import type {
  PriceIntel,
  PriceIntelBuilding,
  PriceIntelReady,
  PriceIntelReason,
  Verdict,
  Confidence
} from './_lib/priceIntel';
export type { PriceIntel, PriceIntelBuilding, PriceIntelReady, PriceIntelReason, Verdict, Confidence };

/** 訂閱列表回傳 item — 既有 Subscription 欄位 + 新 quote block */
export interface WatchWithQuote {
  // ---- 跟既有 GET /api/subscriptions 一致（snake_case 配合 DB） ----
  id: number;
  source_id: string;
  source_type: 'user' | 'group' | 'room';
  origin: string;
  destination: string;
  outbound_date: string | null;
  return_date: string | null;
  max_price: number;
  max_price_traditional: number | null;
  active: boolean;
  paused: boolean;
  label: string | null;
  outbound_min_departure_time: string | null;
  outbound_max_departure_time: string | null;
  return_min_departure_time: string | null;
  return_max_departure_time: string | null;
  created_at?: string;
  /** 航司過濾（0012）：只追這些航司；null = 全部 */
  airline_filter?: string[] | null;

  /** 新增：本次回傳的即時報價 — 沒有快取資料就 null */
  quote: WatchQuote | null;

  /**
   * G1: 此 watch 目前的成員數。
   * 個人訂閱永遠 0；群組訂閱建立者會自動 +1。
   * 卡片右上顯示「N 人在追」pill 用這個。
   * 0 → 不顯示 pill；1 (只有建立者) → 顯示「我」；≥2 → 顯示「N 人」。
   */
  memberCount?: number;
}
