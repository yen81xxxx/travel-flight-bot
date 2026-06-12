/**
 * DigestHero — 「今日最佳時機」綠色提示卡
 *
 * 顯示條件（設計手冊 §4.1）— caller 應該在 props 進來之前過好：
 *   - 至少 1 個非 paused 的 watch 是「已達標」(signal === 'hit')
 *   - 目前 filter 是「全部」
 *
 * PR #20（手冊 §4.7 + §4.8 新版）：
 *   - 右上加 verdict chip（跟 VerdictBadge 同語言）
 *   - reason row：第一條 intel reason + 信心 chip（grounded — 用算出來的證據，不發明稀缺感）
 *   - 大 CTA「查看航班並訂閱」
 *   - 軟化規則：confidence='低' 或 intel 缺 → CTA 退回次要樣式 + 中性文案，
 *     不暗示強烈買進（這是跟 Hopper 式 pressure 的刻意區別）
 *
 * 顯示資料：手冊規定挑「最便宜的達標訂閱」當主角。pick 邏輯在 pickDigestWatch()。
 */
import * as React from 'react';
import type { WatchItem } from '../_hooks/useWatchlist';
import { deriveSignal } from '../_lib/signal';
import { VERDICT_META } from '../_lib/priceIntel';
import { getCity } from '@/config/airports';
import { Icon, type IconName, ICON_NAMES } from './Icon';
import { Sparkline } from './Sparkline';

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

function safeIconName(name: string): IconName {
  return (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : 'info';
}

export function DigestHero({ watch: w, onOpen }: Props): React.ReactElement | null {
  // 防呆：caller 沒過濾就傳沒 quote 的進來，render null（不 crash）
  if (!w.quote) return null;

  const deltaPct = w.quote.deltaPct;
  const down = deltaPct != null && deltaPct < 0;
  const originCity = getCity(w.origin);
  const destCity = getCity(w.destination);
  const dist = Number(w.max_price) - w.quote.currentBest;

  // PR #20: intel-grounded 元素
  const intel = w.quote.intel?.status === 'ready' ? w.quote.intel : null;
  const vMeta = intel ? (VERDICT_META[intel.verdict] ?? VERDICT_META.watch) : null;
  const firstReason = intel?.reasons[0] ?? null;
  // 軟化規則（手冊 §4.7）：信心低或沒 intel → 不出強 CTA
  const strongCta = intel != null && intel.confidence !== '低';

  return (
    <div
      className="digest pressable"
      onClick={() => onOpen(w)}
      data-testid="digest-hero"
    >
      {/* top: eyebrow + verdict chip */}
      <div className="digest-top">
        <div className="digest-eyebrow">
          <Icon name="target" size={13} stroke={2} />
          <span>今日最佳時機</span>
        </div>
        {vMeta && (
          <div className="digest-verdict" data-testid="digest-verdict">
            <Icon name={safeIconName(vMeta.icon)} size={13} stroke={2.3} />
            {vMeta.label}
          </div>
        )}
      </div>

      {/* route */}
      <div className="digest-route">
        {originCity}
        <Icon name="airplane" size={15} style={{ transform: 'rotate(90deg)', color: 'var(--ios-green)' }} />
        {destCity}
        <span className="digest-codes tnum">{w.origin}→{w.destination}</span>
      </div>

      {/* main: price block + sparkline */}
      <div className="digest-main">
        <div className="digest-price-block">
          <div className="digest-now">
            <span className="dp-ccy">NT$</span>
            <span className="dp-now tnum">{ntFmt(w.quote.currentBest)}</span>
          </div>
          <div className="digest-meta tnum">
            {deltaPct != null && (
              <span className={`digest-delta ${down ? 'down' : 'up'}`}>
                <Icon name={down ? 'trendDown' : 'trendUp'} size={13} stroke={2.3} />
                {Math.abs(deltaPct).toFixed(1)}%
              </span>
            )}
            {dist > 0 && (
              <>
                {deltaPct != null && <span className="digest-dot" />}
                <span>低於目標 NT${ntFmt(dist)}</span>
              </>
            )}
          </div>
        </div>
        {w.quote.history.length >= 2 && (
          <div className="digest-spark">
            <Sparkline history={w.quote.history} color="var(--ios-green)" width={100} height={42} />
            <span className="digest-spark-label">近 {w.quote.history.length} 天</span>
          </div>
        )}
      </div>

      {/* PR #20: grounded reason + confidence chip（手冊 §4.7 — 證據不是稀缺感） */}
      {firstReason && (
        <div className="digest-reason" data-testid="digest-reason">
          <Icon name={safeIconName(firstReason.icon)} size={13} stroke={2} />
          <span>{firstReason.t}</span>
          {intel?.confidence && <span className="digest-conf">信心 {intel.confidence}</span>}
        </div>
      )}

      {/* CTA — strong（綠底）或 soften（次要） */}
      {strongCta ? (
        <button
          type="button"
          className="digest-cta-btn pressable"
          data-testid="digest-cta-strong"
          onClick={(e) => { e.stopPropagation(); onOpen(w); }}
        >
          <Icon name="airplane" size={16} stroke={2} style={{ transform: 'rotate(90deg)' }} />
          查看航班並訂閱
          <Icon name="chevronRight" size={15} stroke={2.4} style={{ marginLeft: 'auto' }} />
        </button>
      ) : (
        <button
          type="button"
          className="digest-cta-soft pressable"
          data-testid="digest-cta-soft"
          onClick={(e) => { e.stopPropagation(); onOpen(w); }}
        >
          查看走勢與航班
          <Icon name="chevronRight" size={14} stroke={2.2} />
        </button>
      )}

      <style jsx>{`
        .digest {
          background: linear-gradient(180deg, rgba(48,209,88,0.18) 0%, rgba(48,209,88,0.06) 100%);
          border: 1px solid rgba(48, 209, 88, 0.35);
          border-radius: var(--r-card);
          padding: 14px 16px;
          margin-bottom: 16px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .digest-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
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
        .digest-verdict {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          font-weight: 700;
          color: #06351a;
          background: var(--ios-green);
          padding: 4px 11px 4px 8px;
          border-radius: 999px;
          letter-spacing: -0.1px;
        }
        .digest-route {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 16px;
          font-weight: 600;
          flex-wrap: wrap;
          color: var(--ios-label);
        }
        .digest-codes {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--ios-label-3);
          letter-spacing: 0.5px;
        }
        .digest-main {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
        }
        .digest-price-block { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
        .digest-now { display: flex; align-items: baseline; gap: 5px; }
        .dp-ccy {
          font-size: 14px;
          font-weight: 600;
          color: var(--ios-label-2);
        }
        .dp-now {
          font-size: 34px;
          font-weight: 800;
          color: var(--ios-label);
          letter-spacing: -0.8px;
          line-height: 1;
        }
        .digest-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--ios-label-2);
        }
        .digest-delta {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-weight: 700;
        }
        .digest-delta.down { color: var(--ios-green); }
        .digest-delta.up { color: var(--ios-red); }
        .digest-dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--ios-label-3);
        }
        .digest-spark {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 3px;
          flex-shrink: 0;
        }
        .digest-spark-label {
          font-size: 10px;
          color: var(--ios-label-3);
        }
        .digest-reason {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          color: var(--ios-label-2);
          padding-top: 11px;
          border-top: 0.5px solid rgba(48, 209, 88, 0.2);
        }
        .digest-conf {
          margin-left: auto;
          font-size: 11px;
          font-weight: 600;
          color: var(--ios-green);
          background: rgba(48, 209, 88, 0.14);
          padding: 3px 8px;
          border-radius: 999px;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .digest-cta-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          background: var(--ios-green);
          color: #06351a;
          border: none;
          border-radius: 12px;
          padding: 13px 15px;
          font-family: inherit;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: -0.2px;
          box-shadow: 0 4px 14px rgba(48, 209, 88, 0.28);
          min-height: 44px;
        }
        .digest-cta-soft {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
          width: 100%;
          background: transparent;
          color: var(--ios-green);
          border: none;
          padding: 6px 0 0;
          font-family: inherit;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

export default DigestHero;
