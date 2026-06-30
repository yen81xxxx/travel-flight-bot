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

/** 釘選班次的一段（去 / 回 / 單程），給卡片對齊排版用 */
export interface PinnedLeg { dir: '去' | '回' | null; date: string | null; airline: string; time: string | null; }

/**
 * 把存的 pinned_flight_label 解析成 {航司, 時間}。容兩種格式：
 *   開口式 '去 長榮航空 15:20'（前綴去/回 + 空白分隔）
 *   單程/來回 '長榮航空 · 10:25'（· 分隔）
 */
function parseLeg(label: string): { airline: string; time: string | null } {
  const s = label.replace(/^[去回]\s*/, '').trim();
  const m = s.match(/^(.*?)[\s·]+(\d{1,2}:\d{2})$/);
  return m ? { airline: m[1].trim(), time: m[2] } : { airline: s, time: null };
}

/**
 * 從 watch 算出「釘選班次」列表（統一給開口式 / 來回 / 單程用）。沒釘 → null。
 *   開口式（openJaw + 2 標籤）→ 去(outbound_date) + 回(return_date)
 *   來回（有 return_date）→ 釘的去程班，標「去」
 *   單程（無 return_date）→ 該班，不標去/回
 */
function buildPinnedLegs(w: WatchItem): PinnedLeg[] | null {
  const labels = w.pinned_flight_labels;
  if (!labels || labels.length === 0) return null;
  if (w.quote?.openJaw && labels.length >= 2) {
    return [
      { dir: '去', date: w.outbound_date, ...parseLeg(labels[0]) },
      { dir: '回', date: w.return_date, ...parseLeg(labels[1]) }
    ];
  }
  return labels.map(l => ({ dir: (w.return_date ? '去' : null) as '去' | null, date: w.outbound_date, ...parseLeg(l) }));
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

  // === 釘選班次（統一排版）：有釘班的 watch 一律用對齊網格顯示去/回/單程；沒釘才走下面摘要 ===
  const pinnedLegs = buildPinnedLegs(w);

  // === 航司 label（只有「沒釘」的 watch 才用摘要：廉航 / 傳統 / 多城市票）===
  let carrierLabel: React.ReactNode = null;
  if (w.quote && !pinnedLegs) {
    if (w.quote.openJaw) {
      carrierLabel = (
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

  // === meta 列片段（· 分隔，第一段不帶分隔點）===
  // 沒釘 → 日期區間打頭；釘了 → 班次列已自帶日期，不重複顯示區間，只補「單程」標記
  // （單程才標，去/回兩段自明）+ 天數倒數 + label。
  const metaParts: React.ReactNode[] = [];
  if (!pinnedLegs) {
    metaParts.push(<span key="range" className="tnum">{dateRange}</span>);
  } else if (!w.return_date) {
    metaParts.push(<span key="ow">單程</span>);
  }
  if (days != null && days >= 0) {
    metaParts.push(<span key="days" className="wc-count tnum">{days} 天後出發</span>);
  }
  if (w.label) {
    metaParts.push(<span key="label">{w.label}</span>);
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
          {isOpenJaw && <span className="oj-pill" data-testid="oj-pill">異地來回</span>}
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

      {/* ---- 2. 釘選班次（取代日期列）：班次自帶日期，往上移到原日期區間位置，不再重複顯示區間 ---- */}
      {pinnedLegs && (
        <div className="wc-legs" data-testid="wc-legs">
          {pinnedLegs.map((leg, i) => (
            <div className="wc-leg" key={i}>
              {leg.dir && (
                <span className={`wc-leg-dir ${leg.dir === '去' ? 'out' : 'back'}`}>{leg.dir}</span>
              )}
              <span className="wc-leg-date tnum">{mdFmt(leg.date)}</span>
              <span className="wc-leg-airline">{leg.airline}</span>
              <span className="wc-leg-time tnum">{leg.time ?? ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* ---- 3. meta row：日期區間（沒釘）/ 單程標記（釘了單程）+ 天數倒數 + label ---- */}
      {metaParts.length > 0 && (
        <div className="wc-meta">
          {metaParts.map((p, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="dot" />}
              {p}
            </React.Fragment>
          ))}
        </div>
      )}

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
            {/* 釘了班 → 班次列已移到上方日期位置；這裡只放沒釘時的航司摘要 */}
            {carrierLabel && <span className="wc-carrier">{carrierLabel}</span>}
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
        /* 釘選班次（統一）：去/回/單程一律對齊網格（方向｜日期｜航司｜時間）
           已上移到原日期列位置 → margin/字級比照 meta 列，當主資訊讀。
           欄位一律 auto + 整組靠左（justify-content:start）→ 時間緊跟航司，
           不再被 1fr 撐到最右邊（航司與時間是同一筆資訊，要放一起）。 */
        .wc-legs {
          display: grid;
          grid-template-columns: auto auto auto auto;
          justify-content: start;
          column-gap: 8px;
          row-gap: 5px;
          align-items: center;
          margin-top: 8px;
        }
        .wc-leg {
          display: contents;
        }
        .wc-leg-dir {
          font-size: 10px;
          font-weight: 700;
          border-radius: 4px;
          padding: 1px 5px;
          text-align: center;
        }
        .wc-leg-dir.out { color: var(--ios-blue); background: rgba(10, 132, 255, 0.16); }
        .wc-leg-dir.back { color: var(--ios-purple); background: rgba(191, 90, 242, 0.18); }
        .wc-leg-date {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--ios-label);
        }
        .wc-leg-airline {
          font-size: 12.5px;
          color: var(--ios-label-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .wc-leg-time {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--ios-label);
        }
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
