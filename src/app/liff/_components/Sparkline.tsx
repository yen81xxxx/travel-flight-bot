/**
 * Sparkline — 卡片用的 inline mini chart（純 SVG，零外部 lib）
 *
 * 從 design_handoff_travl_vision/design_reference/vision/charts.jsx port 過來，
 * scaling 數學跟 path 字串組法 verbatim。
 *
 * 顏色策略 (handoff README §4.2):
 *   - 純跌（end ≤ start）→ 綠 `var(--ios-green)`
 *   - 純漲                → 紅 `var(--ios-red)`
 *   - color prop 顯式給就用 prop（讓 caller 客製、debug 友善）
 *
 * 空 / 1 點資料 → 不畫（return null）— caller 必須自己 graceful degrade。
 */
import * as React from 'react';
import type { PricePoint } from '../_types';

interface Props {
  history: PricePoint[];
  /** 顯式給就用這個色；不給的話根據漲跌自動挑 */
  color?: string;
  width?: number;
  height?: number;
}

/** 純函數：根據首尾價格挑顏色 — exposed 讓單測直接斷言 */
export function pickSparklineColor(prices: number[]): string {
  if (prices.length < 2) return 'var(--ios-label-3)';
  return prices[prices.length - 1] <= prices[0] ? 'var(--ios-green)' : 'var(--ios-red)';
}

export function Sparkline({ history, color, width = 76, height = 30 }: Props): React.ReactElement | null {
  // useId 在最上面 — react-hooks/rules-of-hooks：hook 不能在 early return 之後呼叫
  // 比設計手冊的 Math.random() 穩定；同一 component 多次 render 拿一樣的 gradient id
  const reactId = React.useId();

  // 1 點以下沒有「趨勢」可言 — 不畫，讓 caller 自己 fallback
  if (history.length < 2) return null;

  const prices = history.map(h => h.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // 全平 → span=1 避免除 0；視覺上會是中間一條直線
  const span = max - min || 1;
  const padY = 4;
  const finalColor = color ?? pickSparklineColor(prices);

  const x = (i: number): number => (i / (history.length - 1)) * width;
  const y = (p: number): number => padY + (1 - (p - min) / span) * (height - padY * 2);

  const line = prices.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const gid = 'spark' + reactId.replace(/:/g, '');

  // PR #21 a11y（手冊 §4.6a）：金融圖表不能 visual-only — role="img" + 資料摘要，
  // screen reader 聽得到趨勢方向跟關鍵數字，不是只有一個形狀。
  const first = prices[0];
  const last = prices[prices.length - 1];
  const dir = last < first ? '下降' : last > first ? '上升' : '持平';
  const ariaLabel = `近期價格走勢${dir}，最低 NT$${min.toLocaleString()}，目前 NT$${last.toLocaleString()}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
      role="img"
      aria-label={ariaLabel}
      data-testid="sparkline"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={finalColor} stopOpacity="0.28" />
          <stop offset="100%" stopColor={finalColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={finalColor}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        data-testid="sparkline-line"
      />
      <circle
        cx={x(prices.length - 1)}
        cy={y(prices[prices.length - 1])}
        r="2.4"
        fill={finalColor}
      />
    </svg>
  );
}

export default Sparkline;
