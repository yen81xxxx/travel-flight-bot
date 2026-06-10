/**
 * Price Intelligence — 「現在是好價格嗎、該入手還是等？」決策引擎
 *
 * 純統計 / 純算術，**沒有 ML、沒有 API call、沒有 token 消耗**：
 *   - percentile of current price within history
 *   - 1.5/2/3/4 等分位距 (typical-range band p25–p75)
 *   - coefficient of variation → confidence
 *   - threshold rules → verdict ('buy' / 'lean-buy' / 'watch' / 'wait')
 *
 * 從 design_reference/vision/data.jsx 的 priceIntel() 1:1 移植，
 * 加上 deterministic + explainable 兩個關鍵特性：
 *   - 完全可單測（相同 input → 相同 output）
 *   - 每個 verdict 都可以追蹤到某條 reason → 顯給使用者看「為什麼」
 *
 * Data-sufficiency gate（**強制執行**）：
 *   history < MIN_POINTS (14) → 不出 verdict，回 status: 'building'
 *   前端必須畫「情報建立中 · 再 N 天解鎖」，不能假裝有判斷。
 *   設計手冊 §5 講得很白：「a tool that fakes confidence on thin data is how
 *   trust products die」— 這個 gate 是產品定位，不能繞過。
 */
import type { PricePoint } from '../_types';

/** 開始給 verdict 所需的最小歷史點數 (~ 2 週) */
export const MIN_POINTS = 14;

/** 高信心需要的點數門檻 + 變異度上限 */
const HIGH_CONFIDENCE_MIN_POINTS = 25;
const HIGH_CONFIDENCE_MAX_CV = 0.12;

/** 4 種 verdict — 跟設計手冊 PRODUCT_STRATEGY §3 一致 */
export type Verdict = 'buy' | 'lean-buy' | 'watch' | 'wait';

export type Confidence = '高' | '中' | '低';

export interface PriceIntelReason {
  icon: string;  // Icon name (Icon.tsx 認得的 name)
  t: string;     // 顯示給使用者看的中文句子
}

/**
 * Building state — 歷史不夠時的 fallback。
 * 不提 verdict，只給 progress bar 跟剩下天數。
 */
export interface PriceIntelBuilding {
  status: 'building';
  tracked: number;       // 目前累積的點數
  remaining: number;     // 還缺 (= MIN_POINTS - tracked)
  target: number;        // = MIN_POINTS
  pct: number;           // 0–100 (% 進度)
  days: number | null;   // 距出發天數（如有 outDate）
}

/**
 * Ready state — 真實 verdict
 */
export interface PriceIntelReady {
  status: 'ready';
  verdict: Verdict;
  headline: string;
  percentile: number;       // 1–99 (低 = 便宜)
  lo: number;               // 歷史最低
  hi: number;               // 歷史最高
  p25: number;              // 25th percentile (typical-range 下緣)
  p50: number;              // 中位數
  p75: number;              // 75th percentile (typical-range 上緣)
  confidence: Confidence;
  reasons: PriceIntelReason[];
  days: number | null;
  hitTarget: boolean;       // 是否 ≤ user 目標
  tracked: number;
}

export type PriceIntel = PriceIntelBuilding | PriceIntelReady;

/** quantile — sorted ascending, f∈[0,1] */
export function quantile(sortedAsc: number[], f: number): number {
  const idx = f * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return Math.round(sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo));
}

/**
 * 算 priceIntel — 主函數，純函數。
 *
 * @param history 歷史價格序列（一天一點，照時間升冪）
 * @param currentBest 當前最低價（與 history 末尾通常相同，但分開傳是因為 quote 可能來自更新一輪）
 * @param targetLcc 使用者設定的廉航目標價
 * @param daysUntilDeparture 距出發天數（沒設 outbound_date 時可傳 null）
 * @param weeklyDeltaPct vs last week 的 % 變化（沒資料時可傳 null）
 */
export function computePriceIntel(
  history: PricePoint[],
  currentBest: number,
  targetLcc: number,
  daysUntilDeparture: number | null,
  weeklyDeltaPct: number | null
): PriceIntel {
  const prices = history.map(h => h.p);
  const tracked = prices.length;

  // === Building gate — 點數不足直接回 building，不提 verdict ===
  if (tracked < MIN_POINTS) {
    return {
      status: 'building',
      tracked,
      remaining: MIN_POINTS - tracked,
      target: MIN_POINTS,
      pct: Math.round((tracked / MIN_POINTS) * 100),
      days: daysUntilDeparture
    };
  }

  // === Statistics ===
  const sorted = [...prices].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const p25 = quantile(sorted, 0.25);
  const p50 = quantile(sorted, 0.5);
  const p75 = quantile(sorted, 0.75);

  // Percentile of currentBest within history — 0 = 最便宜，clamp 到 1–99 為了文案順
  const below = sorted.filter(p => p < currentBest).length;
  const denom = sorted.length - 1;
  const percentile = denom > 0
    ? Math.min(99, Math.max(1, Math.round((below / denom) * 100)))
    : 50;
  const hitTarget = currentBest <= targetLcc;

  // Volatility → confidence
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length;
  const sd = Math.sqrt(variance);
  const cv = mean > 0 ? sd / mean : 0;
  let confidence: Confidence;
  if (prices.length >= HIGH_CONFIDENCE_MIN_POINTS && cv < HIGH_CONFIDENCE_MAX_CV) {
    confidence = '高';
  } else if (prices.length >= MIN_POINTS) {
    confidence = '中';
  } else {
    confidence = '低';
  }

  // === Verdict — 嚴格按設計手冊的優先順序 ===
  // 重要：hitTarget 在 percentile 之前，因為「已達標」是 user-defined 的硬訊號
  let verdict: Verdict;
  let headline: string;
  if (hitTarget && percentile <= 25) {
    verdict = 'buy';
    headline = '現在就是好時機';
  } else if (hitTarget) {
    verdict = 'buy';
    headline = '已達標，可入手';
  } else if (percentile <= 25) {
    verdict = 'lean-buy';
    headline = '偏低，可考慮出手';
  } else if (percentile >= 70) {
    verdict = 'wait';
    headline = '目前偏高，建議再等';
  } else {
    verdict = 'watch';
    headline = '價格中段，持續觀察';
  }

  // === Reasoning bullets — 每個 verdict 至少 1 條「為什麼」 ===
  const reasons: PriceIntelReason[] = [];

  // 1. Percentile-based reason (always present)
  if (percentile <= 15) {
    reasons.push({ icon: 'trendDown', t: `逼近近 ${prices.length} 天最低（第 ${percentile} 百分位）` });
  } else if (percentile <= 30) {
    reasons.push({ icon: 'trendDown', t: `落在近期低檔（第 ${percentile} 百分位）` });
  } else if (percentile >= 70) {
    reasons.push({ icon: 'trendUp', t: `高於 ${percentile}% 的歷史報價` });
  } else {
    reasons.push({ icon: 'sliders', t: `位於典型區間（第 ${percentile} 百分位）` });
  }

  // 2. Weekly trend reason (optional)
  if (weeklyDeltaPct != null) {
    if (weeklyDeltaPct <= -3) {
      reasons.push({ icon: 'trendDown', t: `近一週下跌 ${Math.abs(weeklyDeltaPct).toFixed(1)}%` });
    } else if (weeklyDeltaPct >= 3) {
      reasons.push({ icon: 'trendUp', t: `近一週回升 ${weeklyDeltaPct.toFixed(1)}%，別等太久` });
    }
  }

  // 3. Days-to-departure reason (optional)
  if (daysUntilDeparture != null) {
    if (daysUntilDeparture >= 0 && daysUntilDeparture <= 30) {
      reasons.push({ icon: 'hourglass', t: `距出發僅 ${daysUntilDeparture} 天，降價空間有限` });
    } else if (daysUntilDeparture > 90) {
      reasons.push({ icon: 'calendar', t: `距出發 ${daysUntilDeparture} 天，仍有觀望時間` });
    }
  }

  return {
    status: 'ready',
    verdict,
    headline,
    percentile,
    lo,
    hi,
    p25,
    p50,
    p75,
    confidence,
    reasons,
    days: daysUntilDeparture,
    hitTarget,
    tracked
  };
}

/** Verdict 顯示用 meta (icon / color / label) */
export const VERDICT_META: Record<Verdict, { label: string; color: string; bg: string; icon: string }> = {
  'buy':      { label: '建議入手', color: 'var(--ios-green)',  bg: 'rgba(48,209,88,0.16)',  icon: 'checkCircle' },
  'lean-buy': { label: '可考慮',   color: 'var(--ios-cyan)',   bg: 'rgba(100,210,255,0.14)', icon: 'trendDown' },
  'watch':    { label: '觀察中',   color: 'var(--ios-label-2)', bg: 'var(--ios-fill-2)',     icon: 'eye' },
  'wait':     { label: '建議再等', color: 'var(--ios-orange)', bg: 'rgba(255,159,10,0.14)', icon: 'hourglass' }
};
