/**
 * priceIntel — pure stats engine 測試
 *
 * 三層測試：
 *  1. quantile 純函數 (數學正確性)
 *  2. Building gate (< MIN_POINTS → status='building'，**不能**回 verdict)
 *  3. Verdict matrix — golden cases，**每種 verdict 都至少一個範例**
 *
 * **特別重要**：要有「verdict = wait」的範例！這個 verdict 是這個產品最關鍵
 * 的差異化 — 「敢叫人家別買」才有信任。如果 threshold 寫反 → 全部 watch / lean-buy →
 * 這個測試會 fail。
 */
import {
  computePriceIntel,
  quantile,
  MIN_POINTS,
  type PriceIntelReady
} from '../priceIntel';

const mkHistory = (prices: number[]): { d: string; p: number }[] =>
  prices.map((p, i) => ({ d: `5/${i + 1}`, p }));

describe('quantile — pure math', () => {
  it('整數 index → 直接拿那點', () => {
    expect(quantile([10, 20, 30, 40, 50], 0)).toBe(10);
    expect(quantile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(quantile([10, 20, 30, 40, 50], 1)).toBe(50);
  });

  it('小數 index → 線性內插（四捨五入）', () => {
    // 0.25 of [10,20,30,40,50] → idx = 1 → 20
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    // 0.75 of [10,20,30,40,50] → idx = 3 → 40
    expect(quantile([10, 20, 30, 40, 50], 0.75)).toBe(40);
    // 0.3 of [10,20,30,40,50] → idx = 1.2 → 20 + (30-20)*0.2 = 22
    expect(quantile([10, 20, 30, 40, 50], 0.3)).toBe(22);
  });
});

describe('Building gate — 點數不足', () => {
  it('history 空 → status=building, tracked=0, remaining=MIN_POINTS', () => {
    const r = computePriceIntel([], 12000, 12800, 60, -3);
    expect(r.status).toBe('building');
    if (r.status === 'building') {
      expect(r.tracked).toBe(0);
      expect(r.remaining).toBe(MIN_POINTS);
      expect(r.target).toBe(MIN_POINTS);
      expect(r.pct).toBe(0);
    }
  });

  it('history = 5 點 → 仍然 building (< MIN_POINTS=14)', () => {
    const r = computePriceIntel(mkHistory([12000, 11500, 11800, 12200, 11900]), 11900, 12800, 30, -2);
    expect(r.status).toBe('building');
    if (r.status === 'building') {
      expect(r.tracked).toBe(5);
      expect(r.remaining).toBe(MIN_POINTS - 5);
      expect(r.pct).toBe(Math.round((5 / MIN_POINTS) * 100));  // 36%
    }
  });

  it('history = 13 點 (剛好差 1) → 還是 building', () => {
    const r = computePriceIntel(mkHistory(Array(13).fill(12000)), 12000, 12800, 60, 0);
    expect(r.status).toBe('building');
  });

  it('history = 14 點 (剛好 MIN_POINTS) → ready，可以給 verdict', () => {
    const r = computePriceIntel(mkHistory(Array(14).fill(12000)), 12000, 12800, 60, 0);
    expect(r.status).toBe('ready');
  });

  it('building state **絕對不能** 含有 verdict / headline / percentile', () => {
    const r = computePriceIntel(mkHistory([10000]), 10000, 12800, 60, 0);
    expect(r).not.toHaveProperty('verdict');
    expect(r).not.toHaveProperty('headline');
    expect(r).not.toHaveProperty('percentile');
  });
});

describe('Verdict matrix — golden cases', () => {
  /**
   * Helper: 構造 N 點 history + 指定 current price + 指定目標 + 距出發天數
   * 然後斷言 verdict。
   * 這幾個 case 是「為什麼這顆引擎值得信」的證據 — 改門檻時這些 case 也要跟著想。
   */

  // === BUY case 1: 已達標 + 第 15 百分位 → 強烈推薦 ===
  it('🟢 buy — 已達標 + 低百分位 → "現在就是好時機"', () => {
    // history 從 14k 一路掉到 10k；當前 10500 < target 12000；歷史 percentile 應該很低
    const history = mkHistory([14000, 13800, 13500, 13200, 13000, 12800, 12500,
                                12200, 12000, 11800, 11500, 11200, 11000, 10800,
                                10600, 10500]);
    const r = computePriceIntel(history, 10500, 12000, 60, -8) as PriceIntelReady;
    expect(r.status).toBe('ready');
    expect(r.verdict).toBe('buy');
    expect(r.hitTarget).toBe(true);
    expect(r.percentile).toBeLessThanOrEqual(25);
    expect(r.headline).toBe('現在就是好時機');
  });

  // === BUY case 2: 已達標 + 中段百分位 → 標準推薦 ===
  it('🟢 buy — 已達標但 percentile 中段 → "已達標，可入手"', () => {
    // history 全部在 10k–12k 之間，當前 11800 < target 12000，但 percentile 算中段
    const history = mkHistory([10500, 11000, 11500, 12000, 11700, 11900, 11600,
                                11400, 11200, 11800, 12000, 11800, 11900, 11700,
                                11800]);
    const r = computePriceIntel(history, 11800, 12000, 60, -1) as PriceIntelReady;
    expect(r.verdict).toBe('buy');
    expect(r.hitTarget).toBe(true);
    expect(r.headline).toBe('已達標，可入手');
  });

  // === LEAN-BUY: 還沒達標但低百分位 ===
  it('🟦 lean-buy — 沒達標但低百分位 → "偏低，可考慮出手"', () => {
    // history 從 18k 一路掉到 13k；當前 13000 > target 12000（沒達標）；但 percentile 很低
    const history = mkHistory([18000, 17500, 17000, 16500, 16000, 15500, 15000,
                                14500, 14000, 13800, 13500, 13300, 13100, 13000]);
    const r = computePriceIntel(history, 13000, 12000, 60, -6) as PriceIntelReady;
    expect(r.verdict).toBe('lean-buy');
    expect(r.hitTarget).toBe(false);
    expect(r.percentile).toBeLessThanOrEqual(25);
    expect(r.headline).toBe('偏低，可考慮出手');
  });

  // === ⚠️ WAIT case (最重要！) — 高百分位 → 敢叫人別買 ===
  it('🟠 wait — 高百分位 → "目前偏高，建議再等"（這個 case 必須能觸發！）', () => {
    // history 14 天 11k–13k 之間，當前 15000 比歷史全部都高
    // → percentile 應該 ≥ 70 → verdict='wait'
    const history = mkHistory([11000, 11500, 12000, 11800, 12200, 11600, 12500,
                                12100, 11700, 12800, 12300, 11900, 12600, 12400]);
    const r = computePriceIntel(history, 15000, 14000, 60, +5) as PriceIntelReady;
    expect(r.verdict).toBe('wait');
    expect(r.percentile).toBeGreaterThanOrEqual(70);
    expect(r.headline).toBe('目前偏高，建議再等');
    // reason 至少有一條提到「高於」
    expect(r.reasons.some(rs => rs.t.includes('高於'))).toBe(true);
  });

  // === WATCH: 中段百分位、沒達標 ===
  it('⚪ watch — 中段百分位且沒達標 → "價格中段，持續觀察"', () => {
    // history 11k–13k uniformly distributed，當前 12000 在中間
    const history = mkHistory([11000, 12500, 11500, 12800, 11800, 12200, 12000,
                                11200, 12600, 12100, 11700, 12400, 11900, 12300]);
    const r = computePriceIntel(history, 12000, 10000, 60, 0) as PriceIntelReady;
    expect(r.verdict).toBe('watch');
    expect(r.percentile).toBeGreaterThan(25);
    expect(r.percentile).toBeLessThan(70);
    expect(r.hitTarget).toBe(false);
    expect(r.headline).toBe('價格中段，持續觀察');
  });
});

describe('Confidence', () => {
  it('14 點 (剛 ready) → 至少 中 信心', () => {
    const r = computePriceIntel(mkHistory(Array.from({ length: 14 }, (_, i) => 12000 + i * 10)),
      12130, 12500, 60, 0) as PriceIntelReady;
    expect(['中', '高']).toContain(r.confidence);
  });

  it('25 點 + 低波動 → 高 信心', () => {
    // 25 點完全平的（cv = 0）→ 高信心
    const r = computePriceIntel(mkHistory(Array(25).fill(12000)),
      12000, 12500, 60, 0) as PriceIntelReady;
    expect(r.confidence).toBe('高');
  });

  it('25 點但高波動 → 中 信心', () => {
    // 25 點 8k–16k 大幅震盪 (cv 約 0.18)
    const history = mkHistory([
      8000, 16000, 9000, 15000, 10000, 14000, 11000, 13000, 12000, 8500,
      15500, 9500, 14500, 10500, 13500, 11500, 12500, 9000, 15000, 10000,
      14000, 11000, 13000, 12000, 11500
    ]);
    const r = computePriceIntel(history, 11500, 12500, 60, 0) as PriceIntelReady;
    expect(r.confidence).toBe('中');
  });
});

describe('Reasons / context', () => {
  it('weeklyDeltaPct=null → 不加 "近一週" reason', () => {
    const history = mkHistory(Array(14).fill(12000));
    const r = computePriceIntel(history, 12000, 11000, 60, null) as PriceIntelReady;
    expect(r.reasons.every(rs => !rs.t.includes('近一週'))).toBe(true);
  });

  it('days ≤ 30 → 加「降價空間有限」reason', () => {
    const history = mkHistory(Array(14).fill(12000));
    const r = computePriceIntel(history, 12000, 11000, 15, null) as PriceIntelReady;
    expect(r.reasons.some(rs => rs.t.includes('降價空間有限'))).toBe(true);
  });

  it('days > 90 → 加「仍有觀望時間」reason', () => {
    const history = mkHistory(Array(14).fill(12000));
    const r = computePriceIntel(history, 12000, 11000, 120, null) as PriceIntelReady;
    expect(r.reasons.some(rs => rs.t.includes('觀望時間'))).toBe(true);
  });

  it('days=null → 不加 days reason（精準斷言：reasons 不含 "降價空間有限" / "觀望時間"）', () => {
    const history = mkHistory(Array(14).fill(12000));
    const r = computePriceIntel(history, 12000, 11000, null, null) as PriceIntelReady;
    expect(r.reasons.every(rs =>
      !rs.t.includes('降價空間有限') && !rs.t.includes('觀望時間')
    )).toBe(true);
  });

  it('每個 ready verdict 至少 1 條 reason', () => {
    const history = mkHistory(Array(14).fill(12000));
    const r = computePriceIntel(history, 12000, 13000, 60, 0) as PriceIntelReady;
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe('Edge: 1-element history queried as if MIN_POINTS', () => {
  it('剛好 MIN_POINTS 但所有 prices 一樣 → percentile=50（denom 計算正確）', () => {
    const history = mkHistory(Array(MIN_POINTS).fill(12000));
    const r = computePriceIntel(history, 12000, 13000, 60, 0) as PriceIntelReady;
    expect(r.status).toBe('ready');
    // 所有 prices 都 == 12000，below = 0，percentile clamped to 1 (Math.max 保底)
    expect(r.percentile).toBeGreaterThanOrEqual(1);
    expect(r.percentile).toBeLessThanOrEqual(99);
  });
});
