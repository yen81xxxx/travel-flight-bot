/**
 * PriceChart — 詳細頁 buy-now-or-wait 主圖（純 SVG、零 lib）
 *
 * 從 design_handoff_travl_vision/design_reference/vision/charts.jsx port，scaling +
 * 標記邏輯 verbatim。功能 (handoff README §4.3):
 *   - area + line：價格走勢
 *   - dashed 綠線 + 「目標 {price}」label：使用者目標價
 *   - 空心小圓：series 最低點（min marker）
 *   - 大實心圓：最新點（已達標→綠 / 未達標→accent）
 *   - 3 個 x 軸刻度：頭、中、尾的 PricePoint.d
 *
 * Y 軸 padding 邏輯：上下各墊 12% × (hi - lo)（或 500 NT$ if span tiny）
 * 確保 target line 跟頂峰不會貼齊 svg 邊。
 */
import * as React from 'react';
import type { PricePoint } from '../_types';

interface Props {
  history: PricePoint[];
  /** 使用者目標價（廉航目標），畫一條 dashed 綠線 */
  target: number;
  /** 主線色 — 預設 cyan（廉航味），呼叫端可給 yellow 表示傳統 */
  accent?: string;
  height?: number;
  /**
   * PR #5: 典型區間 (25th–75th percentile)。給就在背景畫一條半透明帶，
   * 讓使用者「目視」現在價位相對於常態的位置。null 時不畫。
   */
  band?: { p25: number; p75: number } | null;
}

/**
 * 算 Y 軸 min/max（上下 padding 12%）— 抽出純函數方便單測，
 * UI 不會 regression
 */
export function computePriceChartScale(prices: number[], target: number): {
  min: number;
  max: number;
  span: number;
} {
  const lo = Math.min(...prices, target);
  const hi = Math.max(...prices, target);
  // tiny span: 全部一樣價 / target == price → 用 500 NT$ 當預設 padding
  const pad = (hi - lo) * 0.12 || 500;
  const min = lo - pad;
  const max = hi + pad;
  // span=0 不可能因為 pad>0；保險仍 || 1
  const span = max - min || 1;
  return { min, max, span };
}

/** 3 個 x 軸刻度 index：頭、中、尾 — 抽出方便單測 */
export function computeTickIndices(length: number): [number, number, number] {
  const mid = Math.floor((length - 1) / 2);
  return [0, mid, length - 1];
}

export function PriceChart({
  history,
  target,
  accent = 'var(--ios-cyan)',
  height = 172,
  band = null
}: Props): React.ReactElement | null {
  // useId 在最上面 — react-hooks/rules-of-hooks 不准 hook 在 early return 之後
  const reactId = React.useId();

  // 2 點以下沒辦法畫線 — caller 應 graceful degrade（隱藏整張圖）
  if (history.length < 2) return null;

  const W = 340;
  const H = height;
  const padL = 6;
  const padR = 6;
  const padT = 18;
  const padB = 24;

  const prices = history.map(h => h.p);
  // 算 y 軸範圍時也納入 band 上下緣，避免 band 被剪掉視覺斷裂
  const scaleInputs = band
    ? [...prices, band.p25, band.p75]
    : prices;
  // max 不在 render 用（span 已從 computePriceChartScale 預算）— 只 destructure 用得到的
  const { min, span } = computePriceChartScale(scaleInputs, target);

  const x = (i: number): number => padL + (i / (history.length - 1)) * (W - padL - padR);
  const y = (p: number): number => padT + (1 - (p - min) / span) * (H - padT - padB);

  const line = prices.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const area = `${line} L${x(prices.length - 1)} ${H - padB} L${x(0)} ${H - padB} Z`;

  const lastX = x(prices.length - 1);
  const lastY = y(prices[prices.length - 1]);
  const minIdx = prices.indexOf(Math.min(...prices));
  const ty = y(target);
  const ticks = computeTickIndices(history.length);
  // 最新點是否「已達標」決定 marker 色 — 跟卡片上的 signal 視覺一致
  const below = prices[prices.length - 1] <= target;
  const gid = 'pc' + reactId.replace(/:/g, '');

  // PR #21 a11y（手冊 §4.6a）：完整圖表的資料摘要 — 區間 / 目前 / 目標 / 高低於目標
  const loPrice = Math.min(...prices);
  const hiPrice = Math.max(...prices);
  const ariaLabel =
    `價格走勢圖：區間 NT$${loPrice.toLocaleString()} 至 NT$${hiPrice.toLocaleString()}，` +
    `目前 NT$${prices[prices.length - 1].toLocaleString()}，目標價 NT$${target.toLocaleString()}，` +
    `目前${below ? '已低於' : '高於'}目標。`;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block', overflow: 'visible' }}
      role="img"
      aria-label={ariaLabel}
      data-testid="price-chart"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.30" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* PR #5: 典型區間 band (p25–p75) — 畫在 target 之前、line 之後（半透明灰、視覺最 background） */}
      {band && (
        <rect
          x={padL}
          y={y(band.p75)}
          width={W - padL - padR}
          height={Math.max(0, y(band.p25) - y(band.p75))}
          fill="var(--ios-label-3)"
          opacity="0.12"
          data-testid="typical-range-band"
        />
      )}

      {/* 目標線 (dashed) + 右側 label */}
      <line
        x1={padL}
        y1={ty}
        x2={W - padR}
        y2={ty}
        stroke="var(--ios-green)"
        strokeWidth="1"
        strokeDasharray="4 4"
        opacity="0.8"
        data-testid="target-line"
      />
      <g transform={`translate(${W - padR}, ${ty})`}>
        <rect x="-66" y="-9" width="66" height="18" rx="5" fill="rgba(48,209,88,0.16)" />
        <text
          x="-33"
          y="4"
          textAnchor="middle"
          fontSize="10.5"
          fontWeight="700"
          fill="var(--ios-green)"
          fontFamily="-apple-system, system-ui"
          style={{ fontFeatureSettings: "'tnum' 1" }}
        >
          目標 {target.toLocaleString()}
        </text>
      </g>

      {/* area + line */}
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={accent}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        data-testid="price-line"
      />

      {/* min marker：空心圓 */}
      <circle
        cx={x(minIdx)}
        cy={y(prices[minIdx])}
        r="2.6"
        fill="var(--ios-bg)"
        stroke={accent}
        strokeWidth="1.6"
        data-testid="min-marker"
      />

      {/* latest marker：halo + 實心 — 已達標時整顆變綠 */}
      <circle
        cx={lastX}
        cy={lastY}
        r="9"
        fill={below ? 'rgba(48,209,88,0.18)' : 'rgba(100,210,255,0.18)'}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="4"
        fill={below ? 'var(--ios-green)' : accent}
        data-testid="latest-marker"
      />

      {/* x 軸刻度（頭/中/尾的 d 標籤） */}
      {ticks.map((ti, k) => (
        <text
          key={k}
          x={x(ti)}
          y={H - 6}
          textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
          fontSize="10"
          fill="var(--ios-label-3)"
          fontFamily="-apple-system, system-ui"
          style={{ fontFeatureSettings: "'tnum' 1" }}
        >
          {history[ti].d}
        </text>
      ))}
    </svg>
  );
}

export default PriceChart;
