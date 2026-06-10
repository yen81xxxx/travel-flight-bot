/**
 * PercentileBar — 「當前價在歷史的第 N 百分位」橫條
 *
 * 視覺：紅 → 黃 → 綠 gradient（左=最高=百分位 99，右=最便宜=百分位 1）
 * 跟手冊 §3 顏色語意一致：綠 = 該買 / 紅 = 建議再等。
 *
 * marker 位置：percentile 1 → 最右、99 → 最左。
 * 邏輯：x% from right = percentile / 100。
 * 視覺：百分位低=便宜=靠右=綠色，看一眼就知道「現在便宜還是貴」。
 *
 * 純 presentation — 不算 percentile，由 caller 從 PriceIntel 拿。
 */
import * as React from 'react';

interface Props {
  /** 1–99，越低越便宜（百分位） */
  percentile: number;
  /** 緊湊型（WatchCard 用） — 縮小高度 */
  compact?: boolean;
}

export function PercentileBar({ percentile, compact = false }: Props): React.ReactElement {
  // marker 位置：percentile 1 → 99%（最右），percentile 99 → 1%（最左）
  const markerLeft = 100 - percentile;
  return (
    <div className={`p-bar ${compact ? 'compact' : ''}`} data-testid="percentile-bar" data-percentile={percentile}>
      <div className="p-track">
        <div className="p-marker" style={{ left: `${markerLeft}%` }} />
      </div>
      {!compact && (
        <div className="p-labels">
          <span>便宜</span>
          <span className="tnum">第 {percentile} 百分位</span>
          <span>貴</span>
        </div>
      )}
      <style jsx>{`
        .p-bar {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .p-track {
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right,
            var(--ios-red) 0%,
            var(--ios-orange) 30%,
            var(--ios-yellow) 55%,
            var(--ios-green) 100%
          );
          position: relative;
        }
        .p-bar.compact .p-track { height: 4px; }
        .p-marker {
          position: absolute;
          top: -2px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--ios-label);
          border: 2px solid var(--ios-bg);
          transform: translateX(-50%);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        }
        .p-bar.compact .p-marker { width: 8px; height: 8px; top: -2px; }
        .p-labels {
          display: flex;
          justify-content: space-between;
          font-size: 10.5px;
          color: var(--ios-label-3);
        }
      `}</style>
    </div>
  );
}

export default PercentileBar;
