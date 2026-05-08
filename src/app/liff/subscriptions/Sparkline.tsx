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

/**
 * 過去 30 天最低價迷你折線圖（純 SVG，不依賴圖表庫）
 */
export default function Sparkline({ origin, destination, outboundDate, returnDate, threshold }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ origin, destination, days: '30' });
    if (outboundDate) params.set('outboundDate', outboundDate);
    if (returnDate) params.set('returnDate', returnDate);

    fetch(`/api/subscriptions/history?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setPoints(d.points ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [origin, destination, outboundDate, returnDate]);

  if (loading) {
    return <div className="spark-empty">載入歷史…</div>;
  }
  if (points.length < 2) {
    return <div className="spark-empty">📊 歷史紀錄不足，再追蹤幾天就有走勢圖</div>;
  }

  // 圖表尺寸
  const W = 280;
  const H = 60;
  const pad = 4;

  const prices = points.map(p => p.minPrice);
  const minP = Math.min(...prices, threshold);
  const maxP = Math.max(...prices, threshold);
  const range = Math.max(1, maxP - minP);

  const xScale = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const yScale = (price: number) => H - pad - ((price - minP) / range) * (H - 2 * pad);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(p.minPrice).toFixed(1)}`)
    .join(' ');

  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const trend = lastPoint.minPrice - firstPoint.minPrice;
  const trendPct = ((trend / firstPoint.minPrice) * 100).toFixed(1);

  const thresholdY = yScale(threshold);
  const minHistoryPrice = Math.min(...prices);
  const maxHistoryPrice = Math.max(...prices);

  return (
    <div className="spark">
      <div className="spark-header">
        <span className="spark-label">過去 {points.length} 天走勢</span>
        <span className={`spark-trend ${trend < 0 ? 'down' : trend > 0 ? 'up' : ''}`}>
          {trend < 0 ? '↓' : trend > 0 ? '↑' : '→'} {Math.abs(parseFloat(trendPct))}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="spark-svg">
        {/* 門檻虛線 */}
        <line
          x1={pad} y1={thresholdY} x2={W - pad} y2={thresholdY}
          stroke="#ff7a45" strokeWidth="1" strokeDasharray="3 3" opacity="0.5"
        />
        {/* 折線 */}
        <path d={path} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* 點 */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={xScale(i)}
            cy={yScale(p.minPrice)}
            r={i === points.length - 1 ? 3 : 1.5}
            fill={p.minPrice <= threshold ? '#4ade80' : '#60a5fa'}
          />
        ))}
      </svg>
      <div className="spark-footer">
        <span>最低 NT$ {minHistoryPrice.toLocaleString()}</span>
        <span>最高 NT$ {maxHistoryPrice.toLocaleString()}</span>
      </div>
      <style jsx>{`
        .spark {
          margin-top: 12px;
          padding: 12px;
          background: rgba(96, 165, 250, 0.05);
          border: 1px solid rgba(96, 165, 250, 0.15);
          border-radius: 10px;
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
        .spark-footer {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #5a6280;
          margin-top: 4px;
        }
        .spark-empty {
          margin-top: 10px;
          padding: 10px;
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
