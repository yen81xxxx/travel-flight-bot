/**
 * SkeletonCard + LoadingState — 載入時的 shimmer 骨架（取代 Spinner）
 *
 * 設計手冊 §4.6 (design_reference/vision/states.jsx SkeletonCard/LoadingState 1:1 port)：
 *   - 模仿 WatchCard 的版型（route 列 / meta 線 / 價格+sparkline / signal 列）
 *   - shimmer 動畫 gate 在 prefers-reduced-motion（reduce 時直接靜止）
 *   - LoadingState 包 3 張 + aria-busy（a11y：screen reader 知道在載入）
 *
 * caller (WatchlistView) 顯示這個時要藏 FAB。
 */
import * as React from 'react';

export function SkeletonCard(): React.ReactElement {
  return (
    <div className="skel-card" data-testid="skeleton-card">
      <div className="skel-row">
        <div className="skel skel-line" style={{ width: '46%', height: 18 }} />
        <div className="skel skel-pill" style={{ width: 54 }} />
      </div>
      <div className="skel skel-line" style={{ width: '62%', height: 12 }} />
      <div className="skel-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="skel skel-line" style={{ width: 64, height: 10, marginBottom: 8 }} />
          <div className="skel skel-line" style={{ width: 110, height: 26 }} />
        </div>
        <div className="skel skel-spark" />
      </div>
      <div className="skel-row" style={{ paddingTop: 12, borderTop: '0.5px solid var(--ios-hairline)' }}>
        <div className="skel skel-pill" style={{ width: 92 }} />
        <div className="skel skel-line" style={{ width: 70, height: 12 }} />
      </div>

      <style jsx>{`
        .skel-card {
          background: var(--card-grad);
          border: 0.5px solid var(--ios-separator-2);
          border-radius: 16px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 12px;
        }
        .skel-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .skel {
          background: var(--ios-fill-2);
          border-radius: 6px;
          position: relative;
          overflow: hidden;
        }
        .skel-line { border-radius: 5px; }
        .skel-pill { height: 22px; border-radius: 999px; }
        .skel-spark { width: 84px; height: 34px; border-radius: 8px; }
        .skel::after {
          content: '';
          position: absolute;
          inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
          animation: shimmer 1.4s infinite;
        }
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .skel::after { animation: none; }
        }
      `}</style>
    </div>
  );
}

/** 3 張骨架 + aria-busy — watchlist 載入中的整段畫面 */
export function LoadingState(): React.ReactElement {
  return (
    <div aria-busy="true" aria-label="載入追蹤清單中" data-testid="loading-state">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}

export default SkeletonCard;
