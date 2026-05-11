'use client';

import { useEffect, useState } from 'react';

interface Props {
  origin: string;
  destination: string;
  outboundDate: string | null;
  returnDate: string | null;
  threshold: number;
}

interface Point {
  date: string;
  minPrice: number;
}

type RangeKey = 7 | 30 | 365;
const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 7, label: '7 天' },
  { key: 30, label: '30 天' },
  { key: 365, label: '1 年' }
];

/**
 * 過去 N 天最低價迷你折線圖（純 SVG，不依賴圖表庫）
 * 支援 7/30/365 天切換、min/max/current 點價格標註
 */
export default function Sparkline({ origin, destination, outboundDate, returnDate, threshold }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<RangeKey>(30);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ origin, destination, days: String(days) });
    if (outboundDate) params.set('outboundDate', outboundDate);
    if (returnDate) params.set('returnDate', returnDate);

    fetch(`/api/subscriptions/history?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setPoints(d.points ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [origin, destination, outboundDate, returnDate, days]);

  // 圖表尺寸
  const W = 280;
  const H = 90;
  const padX = 8;
  const padTop = 14;
  const padBottom = 18;

  const renderChart = () => {
    if (points.length < 2) {
      return <div className="spark-empty">📊 此區間紀錄不足，再追蹤幾天就有走勢圖</div>;
    }

    const prices = points.map(p => p.minPrice);
    const minHistoryPrice = Math.min(...prices);
    const maxHistoryPrice = Math.max(...prices);
    const isFlat = minHistoryPrice === maxHistoryPrice;

    const minP = Math.min(...prices, threshold);
    const maxP = Math.max(...prices, threshold);
    const range = Math.max(1, maxP - minP);

    const xScale = (i: number) => padX + (i / (points.length - 1)) * (W - 2 * padX);
    const yScale = (price: number) => H - padBottom - ((price - minP) / range) * (H - padTop - padBottom);

    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(p.minPrice).toFixed(1)}`)
      .join(' ');

    const lastIdx = points.length - 1;
    const lastPrice = points[lastIdx].minPrice;
    const firstPrice = points[0].minPrice;
    const trend = lastPrice - firstPrice;
    const trendPct = ((trend / firstPrice) * 100).toFixed(1);

    const minIdx = prices.indexOf(minHistoryPrice);
    const maxIdx = prices.indexOf(maxHistoryPrice);

    const thresholdY = yScale(threshold);
    // 門檻價跟最後價接近時不顯示門檻標籤（避免重疊）
    const thresholdNearLast = Math.abs(thresholdY - yScale(lastPrice)) < 14;

    // 智慧 textAnchor：左邊用 start、右邊用 end、中間 middle
    const anchorFor = (idx: number): 'start' | 'middle' | 'end' => {
      const ratio = idx / Math.max(1, points.length - 1);
      if (ratio < 0.15) return 'start';
      if (ratio > 0.85) return 'end';
      return 'middle';
    };

    // 標籤顯示策略
    const showMinLabel = !isFlat && minIdx !== lastIdx;
    const showMaxLabel = !isFlat && maxIdx !== lastIdx && maxIdx !== minIdx;

    return (
      <>
        <div className="spark-header">
          <span className="spark-label">
            過去 {points.length} 天 {isFlat && '· 價格無變化'}
          </span>
          <span className={`spark-trend ${trend < 0 ? 'down' : trend > 0 ? 'up' : ''}`}>
            {trend < 0 ? '↓' : trend > 0 ? '↑' : '→'} {Math.abs(parseFloat(trendPct))}%
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="spark-svg">
          {/* 門檻虛線（價格相同時跟資料線重疊，但虛線樣式可區分）*/}
          <line
            x1={padX} y1={thresholdY} x2={W - padX} y2={thresholdY}
            stroke="#ff7a45" strokeWidth="1" strokeDasharray="3 3" opacity="0.5"
          />
          {!thresholdNearLast && (
            <text x={padX} y={thresholdY - 3} fill="#ff7a45" fontSize="8" textAnchor="start" opacity="0.7">
              門檻 {threshold.toLocaleString()}
            </text>
          )}

          {/* 折線 */}
          <path d={path} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* 點 */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={xScale(i)}
              cy={yScale(p.minPrice)}
              r={i === lastIdx ? 3.5 : i === minIdx || i === maxIdx ? 2.5 : 1.5}
              fill={p.minPrice <= threshold ? '#4ade80' : i === lastIdx ? '#fff' : '#60a5fa'}
              stroke={i === lastIdx ? '#60a5fa' : 'none'}
              strokeWidth={i === lastIdx ? 1.5 : 0}
            />
          ))}

          {/* 最低價標註 */}
          {showMinLabel && (
            <text
              x={xScale(minIdx)}
              y={yScale(minHistoryPrice) + 11}
              fill="#4ade80"
              fontSize="9"
              fontWeight="600"
              textAnchor={anchorFor(minIdx)}
            >
              ↓{minHistoryPrice.toLocaleString()}
            </text>
          )}

          {/* 最高價標註 */}
          {showMaxLabel && (
            <text
              x={xScale(maxIdx)}
              y={yScale(maxHistoryPrice) - 4}
              fill="#f87171"
              fontSize="9"
              fontWeight="600"
              textAnchor={anchorFor(maxIdx)}
            >
              ↑{maxHistoryPrice.toLocaleString()}
            </text>
          )}

          {/* 最後一筆（現在）價格 */}
          <text
            x={xScale(lastIdx)}
            y={yScale(lastPrice) - 6}
            fill="#fff"
            fontSize="11"
            fontWeight="700"
            textAnchor="end"
          >
            NT$ {lastPrice.toLocaleString()}
          </text>
        </svg>
      </>
    );
  };

  return (
    <div className="spark">
      <div className="range-tabs">
        {RANGE_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={days === opt.key ? 'tab active' : 'tab'}
            onClick={() => setDays(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="spark-empty">載入歷史…</div>
      ) : (
        renderChart()
      )}

      <style jsx>{`
        .spark {
          margin-top: 12px;
          padding: 12px;
          background: rgba(96, 165, 250, 0.05);
          border: 1px solid rgba(96, 165, 250, 0.15);
          border-radius: 10px;
        }
        .range-tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
        }
        .tab {
          flex: 1;
          padding: 4px 8px;
          font-size: 11px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
          color: #7e88a8;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-family: inherit;
        }
        .tab.active {
          background: rgba(96, 165, 250, 0.18);
          border-color: rgba(96, 165, 250, 0.4);
          color: #60a5fa;
        }
        .spark-header {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #7e88a8;
          margin-bottom: 6px;
        }
        .spark-label { font-weight: 600; letter-spacing: 0.04em; }
        .spark-trend {
          font-weight: 700;
          color: #7e88a8;
        }
        .spark-trend.down { color: #4ade80; }
        .spark-trend.up { color: #f87171; }
        .spark-svg {
          display: block;
          width: 100%;
        }
        .spark-empty {
          padding: 24px 10px;
          font-size: 12px;
          color: #5a6280;
          text-align: center;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
