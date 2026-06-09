/**
 * DigestHero — 「今日最佳時機」綠色提示卡
 *
 * 顯示條件（設計手冊 §4.1）— caller 應該在 props 進來之前過好：
 *   - 至少 1 個非 paused 的 watch 是「已達標」(signal === 'hit')
 *   - 目前 filter 是「全部」
 *
 * 顯示資料：手冊規定挑「最便宜的達標訂閱」當主角 — 避免多個達標時要重複跳。
 * 純 presentation，pick 邏輯抽到 pickDigestWatch() 純函數方便單測。
 */
import * as React from 'react';
import type { WatchItem } from '../_hooks/useWatchlist';
import { deriveSignal } from '../_lib/signal';
import { getCity } from '@/config/airports';
import { Icon } from './Icon';

interface Props {
  watch: WatchItem;
  onOpen: (watch: WatchItem) => void;
}

/**
 * 從 watches 中挑出該秀的「最佳時機」訂閱
 *  - 必須有 quote、非 paused、signal === 'hit'
 *  - 多筆達標時挑 currentBest 最低（最划算）
 * 沒符合的回 null（caller 不 render hero）
 */
export function pickDigestWatch(watches: WatchItem[]): WatchItem | null {
  const hits = watches.filter(w => {
    if (w.paused) return false;
    if (!w.quote) return false;
    return deriveSignal(w.quote.currentBest, Number(w.max_price)) === 'hit';
  });
  if (hits.length === 0) return null;
  return hits.reduce((best, cur) =>
    cur.quote!.currentBest < best.quote!.currentBest ? cur : best
  );
}

const ntFmt = (n: number | null | undefined): string => n != null ? n.toLocaleString() : '—';

export function DigestHero({ watch: w, onOpen }: Props): React.ReactElement | null {
  // 防呆：caller 沒過濾就傳沒 quote 的進來，render null（不 crash）
  if (!w.quote) return null;

  const deltaPct = w.quote.deltaPct;
  const down = deltaPct != null && deltaPct < 0;
  const originCity = getCity(w.origin);
  const destCity = getCity(w.destination);

  return (
    <div
      className="digest pressable"
      onClick={() => onOpen(w)}
      data-testid="digest-hero"
    >
      <div className="digest-eyebrow">
        <Icon name="target" size={13} stroke={2} />
        <span>今日最佳時機</span>
      </div>
      <div className="digest-main">
        <div className="digest-left">
          <div className="digest-route">
            {originCity}
            <Icon name="airplane" size={14} style={{ transform: 'rotate(90deg)', color: 'var(--ios-green)', margin: '0 4px' }} />
            {destCity}
            <span className="digest-codes tnum">{w.origin}→{w.destination}</span>
          </div>
          <div className="digest-msg">
            已跌破你的目標價 <strong>NT${ntFmt(Number(w.max_price))}</strong>
            {deltaPct != null && <>
              ，比上週 <strong>{down ? '↓' : '↑'}{Math.abs(deltaPct).toFixed(1)}%</strong>
            </>}
            {w.quote.history.length >= 2 && '，近 30 天最低'}。
          </div>
        </div>
        <div className="digest-price">
          <span className="dp-ccy">NT$ </span>
          <span className="dp-now tnum">{ntFmt(w.quote.currentBest)}</span>
        </div>
      </div>
      <div className="digest-cta">
        <span>查看走勢與航班</span>
        <Icon name="chevronRight" size={14} stroke={2.2} />
      </div>

      <style jsx>{`
        .digest {
          background: linear-gradient(180deg, rgba(48,209,88,0.18) 0%, rgba(48,209,88,0.06) 100%);
          border: 1px solid rgba(48, 209, 88, 0.35);
          border-radius: var(--r-card);
          padding: 14px 16px;
          margin-bottom: 16px;
          cursor: pointer;
        }
        .digest-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--ios-green);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.4px;
          text-transform: uppercase;
        }
        .digest-main {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-top: 8px;
        }
        .digest-left { min-width: 0; flex: 1; }
        .digest-route {
          display: inline-flex;
          align-items: center;
          font-size: 16px;
          font-weight: 700;
          flex-wrap: wrap;
          color: var(--ios-label);
        }
        .digest-codes {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--ios-label-3);
          margin-left: 6px;
          letter-spacing: 0.5px;
        }
        .digest-msg {
          margin-top: 4px;
          font-size: 12.5px;
          line-height: 1.45;
          color: var(--ios-label-2);
        }
        .digest-msg strong { color: var(--ios-label); font-weight: 700; }
        .digest-price { text-align: right; flex-shrink: 0; }
        .dp-ccy {
          font-size: 12px;
          color: var(--ios-label-2);
          font-weight: 600;
        }
        .dp-now {
          font-size: 26px;
          font-weight: 800;
          color: var(--ios-green);
          letter-spacing: -0.5px;
        }
        .digest-cta {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 4px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 0.5px solid rgba(48, 209, 88, 0.2);
          color: var(--ios-green);
          font-size: 12.5px;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}

export default DigestHero;
