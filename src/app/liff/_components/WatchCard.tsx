/**
 * WatchCard — watchlist 核心列項，每筆訂閱一張卡
 *
 * 對應 design_handoff_travl_vision/README.md §4.2、components.jsx 的 WatchCard。
 *
 * 4 個 row（上到下）：
 *   1. route row：城市 ✈ 城市 + IATA codes / 暫停 + 個人/群組 pill
 *   2. meta row：日期區間 + 「N 天後出發」+ optional label
 *   3. price row：左 = 目前最低 + 航司；右 = delta % + Sparkline
 *   4. signal row：SignalPill + 距目標
 *
 * Graceful degradation（quote=null / history=[] / deltaPct=null）：
 *   - quote=null → price row 顯示目標價當 fallback、無 sparkline、signal=watching
 *   - history 空 → 不畫 sparkline，但 price 還顯示
 *   - deltaPct=null → 不顯示 delta chip
 *
 * paused → 整卡 opacity 降低；hit → 綠色框 highlight。
 */
import * as React from 'react';
import type { WatchItem } from '../_hooks/useWatchlist';
import { deriveSignal, type Signal } from '../_lib/signal';
import { getCity } from '@/config/airports';
import { Icon } from './Icon';
import { Sparkline } from './Sparkline';
import { SignalPill } from './SignalPill';
import { VerdictBadge } from './VerdictBadge';

interface Props {
  watch: WatchItem;
  onOpen: (watch: WatchItem) => void;
}

/** 千分位格式 — null/undefined 顯示 dash */
function ntFmt(n: number | null | undefined): string {
  return n != null ? n.toLocaleString() : '—';
}

/** ISO 日期 'YYYY-MM-DD' → 'M/D'（純字串切，避免時區） */
function mdFmt(s: string | null | undefined): string {
  if (!s) return '';
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
}

/** 距出發天數 — outDate 已過則回負數，caller 自己處理 */
export function daysUntil(yyyymmdd: string | null | undefined): number | null {
  if (!yyyymmdd) return null;
  // 純字串切日期 + 用 UTC 00:00 比較，避免午夜時時區差讓「明天」變「今天」
  const parts = yyyymmdd.split('-').map(p => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const target = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - todayUTC) / 86400000);
}

export function WatchCard({ watch: w, onOpen }: Props): React.ReactElement {
  // === Signal: 沒 quote 直接 watching；有就用 deriveSignal ===
  const signal: Signal = w.quote
    ? deriveSignal(w.quote.currentBest, Number(w.max_price))
    : 'watching';

  // === 顯示值（含 graceful degradation）===
  const currentBest = w.quote?.currentBest ?? null;
  const deltaPct = w.quote?.deltaPct ?? null;
  const history = w.quote?.history ?? [];
  const showSparkline = history.length >= 2;
  const showDelta = deltaPct != null;
  const down = deltaPct != null && deltaPct < 0;

  // 顯示用「距目標」差距 — 用 currentBest，沒料就藏掉
  const dist = currentBest != null ? currentBest - Number(w.max_price) : null;
  const below = dist != null && dist <= 0;

  // === 路線 + meta ===
  const originCity = getCity(w.origin);
  const destCity = getCity(w.destination);
  // 開口式來回（0015）：回程不同地點 → codes 列多顯示回段
  const isOpenJaw = !!(w.return_origin && w.return_destination);
  const days = daysUntil(w.outbound_date);
  const dateRange = w.outbound_date
    ? (w.return_date ? `${mdFmt(w.outbound_date)}–${mdFmt(w.return_date)}` : `${mdFmt(w.outbound_date)} 單程`)
    : '不限定日期';

  // === 開口式「釘了組合」→ 去/回拆兩排顯示（上去程、下回程，各帶日期+航司+時間）===
  // legs 例：['去 長榮航空 15:20', '回 長榮航空 12:15']；去掉「去/回」前綴只留航司+時間，日期另外帶。
  const ojLegs = w.quote?.openJaw && w.pinned_flight_labels && w.pinned_flight_labels.length >= 2
    ? w.pinned_flight_labels
    : null;
  const ojPinned: React.ReactNode = ojLegs ? (
    <div className="wc-oj-pinned" data-testid="wc-oj-pinned">
      <div className="wc-oj-row">
        <span className="wc-oj-dir out">去</span>
        <span className="wc-oj-date tnum">{mdFmt(w.outbound_date)}</span>
        <span className="wc-oj-info">{ojLegs[0].replace(/^去\s*/, '')}</span>
      </div>
      <div className="wc-oj-row">
        <span className="wc-oj-dir back">回</span>
        <span className="wc-oj-date tnum">{mdFmt(w.return_date)}</span>
        <span className="wc-oj-info">{ojLegs[1].replace(/^回\s*/, '')}</span>
      </div>
    </div>
  ) : null;

  // === 航司 label ===
  let carrierLabel: React.ReactNode = null;
  if (w.quote) {
    if (w.quote.openJaw) {
      // 釘了組合 → 用上面的兩排 ojPinned（carrierLabel 留空）；沒釘 → 標「多城市票・帶頭航司 起」。
      carrierLabel = ojLegs ? null : (
        <>
          <span className="wc-ctag oj">多城市票</span>
          {w.quote.openJaw.airline ?? '—'} 起
        </>
      );
    } else if (w.quote.currentType === 'lcc' && w.quote.lcc) {
      const { out, ret } = w.quote.lcc;
      carrierLabel = (
        <>
          <span className="wc-ctag lcc">廉航</span>
          {ret && out !== ret ? `${out} → ${ret}` : out}
        </>
      );
    } else if (w.quote.currentType === 'trad' && w.quote.trad) {
      carrierLabel = (
        <>
          <span className="wc-ctag trad">傳統</span>
          {w.quote.trad.airline}
        </>
      );
    }
  }

  return (
    <article
      className={`watch-card pressable ${w.paused ? 'is-paused' : ''} ${signal === 'hit' ? 'is-hit' : ''}`}
      onClick={() => onOpen(w)}
      data-testid="watch-card"
      data-signal={signal}
      data-source={w._source}
      data-paused={w.paused ? 'true' : 'false'}
    >
      {/* ---- 1. route row ---- */}
      <div className="wc-route-row">
        <div className="wc-route">
          <div className="wc-cities">
            {originCity}
            <Icon name="airplane" size={15} style={{ transform: 'rotate(90deg)', color: 'var(--ios-blue)', margin: '0 4px' }} />
            {destCity}
          </div>
          <span className="wc-codes tnum">
            {w.origin}→{w.destination}
            {isOpenJaw && <span className="wc-oj"> · 回 {w.return_origin}→{w.return_destination}</span>}
          </span>
        </div>
        <div className="wc-tags">
          {isOpenJaw && <span className="oj-pill" data-testid="oj-pill">開口式</span>}
          {w.paused && (
            <span className="paused-pill">
              <Icon name="pause" size={11} stroke={2} /> 已暫停
            </span>
          )}
          {/* G1: 群組訂閱顯示「N 人在追」— 個人訂閱永遠 0，不顯示 */}
          {w._source === 'group' && (w.memberCount ?? 0) >= 1 && (
            <span className="members-pill" data-testid="members-pill">
              <Icon name="people" size={11} stroke={2} />
              {w.memberCount} 人在追
            </span>
          )}
          <span className={`src-pill ${w._source}`}>
            <Icon name={w._source === 'group' ? 'people' : 'person'} size={12} stroke={2} />
            {w._source === 'group' ? '群組' : '個人'}
          </span>
        </div>
      </div>

      {/* ---- 2. meta row ---- */}
      <div className="wc-meta">
        <span className="tnum">{dateRange}</span>
        {days != null && days >= 0 && (
          <>
            <span className="dot" />
            <span className="wc-count tnum">{days} 天後出發</span>
          </>
        )}
        {w.label && (
          <>
            <span className="dot" />
            <span>{w.label}</span>
          </>
        )}
      </div>

      {/* ---- 3. price row ----
        PR #19: quote=null（新路線冷啟動，報價還沒進來）→ 換成「報價更新中」panel，
        不顯示假數字 / NaN / dash 數學（手冊 §4.6 degraded path）。
        有 quote → 原本的價格 + sparkline。
      */}
      {w.quote == null ? (
        <div className="wc-updating" data-testid="quote-updating">
          <div className="wc-upd-head">
            <Icon name="hourglass" size={13} stroke={2} />
            <span>報價更新中</span>
          </div>
          <div className="wc-upd-desc">
            尚未取得這條航線的即時報價。你的目標價 NT${ntFmt(Number(w.max_price))} 已生效，
            仍會在達標時通知你。
          </div>
        </div>
      ) : (
        <div className="wc-price-row">
          <div className="wc-price-left">
            <span className="wc-now-label">目前最低</span>
            <div className="wc-now">
              <span className="ccy">NT$</span>
              <span className="val tnum">{ntFmt(currentBest)}</span>
            </div>
            {carrierLabel && <span className="wc-carrier">{carrierLabel}</span>}
            {ojPinned}
          </div>
          <div className="wc-spark-wrap">
            {showDelta && (
              <span className={`wc-delta ${down ? 'down' : 'up'}`}>
                <Icon name={down ? 'trendDown' : 'trendUp'} size={15} stroke={2.1} />
                {Math.abs(deltaPct!).toFixed(1)}%
              </span>
            )}
            {showSparkline && (
              <Sparkline history={history} width={84} height={34} />
            )}
            {showSparkline && <span className="spark-caption">近 {history.length} 天</span>}
          </div>
        </div>
      )}

      {/* ---- 4. signal row ----
        PR #20 (手冊 §4.8 新版排法，components.jsx 為準)：
          - intel.status='building' → 「情報建立中」pill + 下方進度條 + 已追蹤天數
          - intel.status='ready'    → VerdictBadge (sm) + 距目標；下方百分位文字 row
          - intel=null（但有 quote）→ 退到 SignalPill（graceful degrade 路徑保留）
        PR #19: quote=null（degraded card）→ 全部跳過。
      */}
      {w.quote == null ? null : w.quote.intel?.status === 'building' ? (
        <>
          <div className="wc-signal-row" data-testid="building-state">
            <span className="building-pill">
              <Icon name="hourglass" size={14} stroke={2} />情報建立中
            </span>
            {dist != null && (
              <span className={`wc-target tnum ${below ? 'below' : ''}`}>
                {below
                  ? <>已低於目標 NT${ntFmt(-dist)}</>
                  : <><span className="lead">距目標</span> NT${ntFmt(dist)}</>}
              </span>
            )}
          </div>
          <div className="wc-building">
            <div className="wc-building-bar">
              <div className="wc-building-fill" style={{ width: `${w.quote.intel.pct}%` }} />
            </div>
            <span className="wc-building-txt tnum">
              已追蹤 <strong>{w.quote.intel.tracked}</strong> 天 · 再 <strong>{w.quote.intel.remaining}</strong> 天解鎖買進建議
            </span>
          </div>
        </>
      ) : w.quote.intel?.status === 'ready' ? (
        <>
          <div className="wc-signal-row">
            <VerdictBadge intel={w.quote.intel} size="sm" />
            {dist != null && (
              <span className={`wc-target tnum ${below ? 'below' : ''}`}>
                {below
                  ? <>已低於目標 NT${ntFmt(-dist)}</>
                  : <><span className="lead">距目標</span> NT${ntFmt(dist)}</>}
              </span>
            )}
          </div>
          <div className="wc-pctl-row">
            <span className="wc-pctl tnum" data-testid="percentile-text">
              <Icon name="sliders" size={12} stroke={2} />
              近 {w.quote.intel.tracked} 天位於第 <strong>{w.quote.intel.percentile}</strong> 百分位
            </span>
          </div>
        </>
      ) : (
        <div className="wc-signal-row">
          <SignalPill signal={signal} compact />
          {dist != null && (
            <span className={`wc-target tnum ${below ? 'below' : ''}`}>
              {below
                ? <>已低於目標 NT${ntFmt(-dist)}</>
                : <><span className="lead">距目標</span> NT${ntFmt(dist)}</>}
            </span>
          )}
        </div>
      )}

      <style jsx>{`
        .watch-card {
          background: var(--card-grad);
          border: 1px solid var(--ios-hairline);
          border-radius: var(--r-card);
          padding: 14px;
          margin-bottom: 12px;
          color: var(--ios-label);
          cursor: pointer;
          user-select: none;
        }
        .watch-card.is-paused { opacity: 0.62; }
        .watch-card.is-hit {
          border-color: rgba(48, 209, 88, 0.45);
          box-shadow: 0 0 0 1px rgba(48, 209, 88, 0.2);
        }
        /* ---- row 1 ---- */
        .wc-route-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }
        .wc-route { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .wc-cities {
          display: inline-flex;
          align-items: center;
          font-size: 17px;
          font-weight: 600;
          flex-wrap: wrap;
        }
        .wc-codes {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--ios-label-3);
          letter-spacing: 0.5px;
        }
        .wc-oj { color: var(--ios-blue); }
        .wc-tags { display: flex; gap: 6px; flex-shrink: 0; }
        .oj-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 8px;
          border-radius: var(--r-pill);
          font-size: 10.5px;
          font-weight: 600;
          background: rgba(10, 132, 255, 0.16);
          color: var(--ios-blue);
        }
        .paused-pill, .src-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: var(--r-pill);
          font-size: 10.5px;
          font-weight: 600;
        }
        .paused-pill {
          background: var(--ios-fill-2);
          color: var(--ios-label-2);
        }
        .src-pill.personal {
          background: rgba(10, 132, 255, 0.16);
          color: var(--ios-blue);
        }
        .src-pill.group {
          background: rgba(191, 90, 242, 0.18);
          color: var(--ios-purple);
        }
        .members-pill {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 3px 8px;
          border-radius: var(--r-pill);
          font-size: 10.5px;
          font-weight: 600;
          background: var(--ios-fill-2);
          color: var(--ios-label-2);
        }
        /* ---- row 2 ---- */
        .wc-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
          font-size: 12.5px;
          color: var(--ios-label-2);
        }
        .wc-meta > span { white-space: nowrap; }
        .wc-meta .wc-count { color: var(--ios-orange); font-weight: 600; }
        .dot {
          width: 3px; height: 3px;
          border-radius: 50%;
          background: var(--ios-label-3);
        }
        /* ---- row 3 ---- */
        .wc-price-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 12px;
          margin-top: 14px;
        }
        .wc-price-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .wc-now-label {
          font-size: 11px;
          color: var(--ios-label-3);
          letter-spacing: 0.2px;
          text-transform: uppercase;
        }
        .wc-now {
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
        }
        .ccy {
          font-size: 13px;
          font-weight: 600;
          color: var(--ios-label-2);
        }
        .val {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .wc-carrier {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--ios-label-2);
          margin-top: 2px;
        }
        .wc-ctag {
          padding: 1.5px 6px;
          border-radius: 5px;
          font-size: 10px;
          font-weight: 700;
        }
        .wc-ctag.lcc {
          background: rgba(100, 210, 255, 0.18);
          color: var(--ios-cyan);
        }
        .wc-ctag.trad {
          background: rgba(255, 214, 10, 0.18);
          color: var(--ios-yellow);
        }
        .wc-ctag.oj {
          background: rgba(10, 132, 255, 0.16);
          color: var(--ios-blue);
        }
        /* 開口式釘組合：去/回兩排（上去程、下回程） */
        .wc-oj-pinned {
          display: flex;
          flex-direction: column;
          gap: 3px;
          margin-top: 5px;
        }
        .wc-oj-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          color: var(--ios-label-2);
        }
        .wc-oj-dir {
          font-size: 10px;
          font-weight: 700;
          border-radius: 4px;
          padding: 1px 5px;
          flex-shrink: 0;
        }
        .wc-oj-dir.out { color: var(--ios-blue); background: rgba(10, 132, 255, 0.16); }
        .wc-oj-dir.back { color: var(--ios-purple); background: rgba(191, 90, 242, 0.18); }
        .wc-oj-date { color: var(--ios-label); font-weight: 600; }
        .wc-oj-info { color: var(--ios-label-2); }
        .wc-spark-wrap {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }
        .wc-delta {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 12.5px;
          font-weight: 700;
        }
        .wc-delta.down { color: var(--ios-green); }
        .wc-delta.up { color: var(--ios-red); }
        .spark-caption {
          font-size: 10px;
          color: var(--ios-label-3);
        }
        /* ---- row 4 ---- */
        .wc-signal-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 0.5px solid var(--ios-hairline);
        }
        .wc-target {
          font-size: 12.5px;
          color: var(--ios-label-2);
        }
        .wc-target.below {
          color: var(--ios-green);
          font-weight: 700;
        }
        .wc-target .lead { color: var(--ios-label-3); }
        .wc-updating {
          margin-top: 14px;
          padding: 12px;
          background: var(--ios-fill-3);
          border: 0.5px dashed var(--ios-hairline);
          border-radius: 10px;
        }
        .wc-upd-head {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--ios-label-2);
        }
        .wc-upd-desc {
          font-size: 12px;
          color: var(--ios-label-3);
          line-height: 1.5;
          margin-top: 4px;
        }
        .building-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 11px 5px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          color: var(--ios-label-2);
          background: var(--ios-fill-2);
          white-space: nowrap;
        }
        .wc-building {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .wc-building-bar {
          height: 5px;
          border-radius: 999px;
          background: var(--ios-fill-2);
          overflow: hidden;
        }
        .wc-building-fill {
          height: 100%;
          border-radius: 999px;
          background: var(--ios-label-3);
          transition: width 0.4s ease;
        }
        .wc-building-txt {
          font-size: 11px;
          color: var(--ios-label-3);
        }
        .wc-building-txt strong {
          color: var(--ios-label-2);
          font-weight: 700;
          margin: 0 1px;
        }
        .wc-pctl-row { margin-top: 6px; }
        .wc-pctl {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--ios-label-3);
        }
        .wc-pctl strong {
          color: var(--ios-label-2);
          font-weight: 700;
          margin: 0 1px;
        }
      `}</style>
    </article>
  );
}

export default WatchCard;
