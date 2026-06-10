'use client';

/**
 * WatchDetailSheet — 點 WatchCard 開出來，整個改版的中心。
 *
 * 設計手冊 §4.3。Sections（PR #4a 範圍）：
 *   1. Header — route + sub-line
 *   2. Hero block — 大價格 + 廉航/傳統 + delta + SignalPill
 *   3. Chart card — PriceChart (30 天)（90 天 toggle 留 PR #4b）
 *   4. Current quotes — 廉航 / 傳統 cat-card 雙併
 *   5. (PR #4b 補) 去/回程 flight 詳細列表
 *   6. Per-watch settings — 目標價(廉航/傳統) / 時段 / 暫停
 *   7. Delete button
 *
 * 後端 0 改動：
 *   - PATCH /api/subscriptions  (儲存設定)
 *   - DELETE /api/subscriptions (刪除)
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { Icon } from './Icon';
import { IOSToggle } from './IOSToggle';
import { PriceChart } from './PriceChart';
import { SignalPill } from './SignalPill';
import { IntelPanel } from './IntelPanel';
import { deriveSignal } from '../_lib/signal';
import { getCity } from '@/config/airports';
import { daysUntil } from './WatchCard';
import type { WatchItem } from '../_hooks/useWatchlist';

interface FlightRow {
  airline: string | null;
  airline_code: string | null;
  price: number | null;
  duration_minutes: number | null;
  stops: number;
  departure_time: string | null;
  flight_number: string | null;
}

const TOP_N_DEFAULT = 5;

function fmtDuration(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  watch: WatchItem | null;
  /** 編輯 / 刪除成功後 caller 重新撈 list */
  onMutated?: () => void;
}

const ntFmt = (n: number | null | undefined): string => n != null ? n.toLocaleString() : '—';

export function WatchDetailSheet({ open, onClose, watch, onMutated }: Props): React.ReactElement {
  // === edit state（每次 open / watch 改變時從 watch 帶進來）===
  const [maxPriceStr, setMaxPriceStr] = useState('');
  const [tradEnabled, setTradEnabled] = useState(false);
  const [tradPriceStr, setTradPriceStr] = useState('');
  const [timeFilterEnabled, setTimeFilterEnabled] = useState(false);
  const [outboundMin, setOutboundMin] = useState('');
  const [outboundMax, setOutboundMax] = useState('');
  const [returnMin, setReturnMin] = useState('');
  const [returnMax, setReturnMax] = useState('');
  const [paused, setPaused] = useState(false);

  // === mutation state ===
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // === flight list state (PR #4b) — 從 /api/subscriptions/flights 撈 6h cached
  const [outboundFlights, setOutboundFlights] = useState<FlightRow[]>([]);
  const [returnFlights, setReturnFlights] = useState<FlightRow[]>([]);
  const [flightsLoading, setFlightsLoading] = useState(false);
  const [showAllOutbound, setShowAllOutbound] = useState(false);
  const [showAllReturn, setShowAllReturn] = useState(false);

  // 每次新 watch 進來時，把 form state reset 為該 watch 的值
  useEffect(() => {
    if (!watch || !open) return;
    setMaxPriceStr(String(Number(watch.max_price)));
    const tp = watch.max_price_traditional;
    setTradEnabled(tp != null);
    setTradPriceStr(tp != null ? String(Number(tp)) : '');
    const outMin = watch.outbound_min_departure_time;
    const outMax = watch.outbound_max_departure_time;
    const retMin = watch.return_min_departure_time;
    const retMax = watch.return_max_departure_time;
    setTimeFilterEnabled(!!(outMin || outMax || retMin || retMax));
    setOutboundMin(outMin ?? '');
    setOutboundMax(outMax ?? '');
    setReturnMin(retMin ?? '');
    setReturnMax(retMax ?? '');
    setPaused(!!watch.paused);
    setError(null);
    setConfirmDelete(false);
    setShowAllOutbound(false);
    setShowAllReturn(false);
  }, [watch, open]);

  // 撈 6h 內快取的逐筆航班 — 只在 open + 有 outbound_date 時撈
  useEffect(() => {
    if (!watch || !open || !watch.outbound_date) {
      setOutboundFlights([]);
      setReturnFlights([]);
      return;
    }
    const qs = new URLSearchParams({
      origin: watch.origin,
      destination: watch.destination,
      outboundDate: watch.outbound_date
    });
    if (watch.return_date) qs.set('returnDate', watch.return_date);

    setFlightsLoading(true);
    fetch(`/api/subscriptions/flights?${qs.toString()}`)
      .then(r => r.json())
      .then((data: { ok: boolean; outbound?: FlightRow[]; return?: FlightRow[] }) => {
        if (data.ok) {
          setOutboundFlights(data.outbound ?? []);
          setReturnFlights(data.return ?? []);
        } else {
          setOutboundFlights([]);
          setReturnFlights([]);
        }
      })
      .catch(() => {
        // 撈不到 flight list 不算錯 — 整支 sheet 還是能用
        setOutboundFlights([]);
        setReturnFlights([]);
      })
      .finally(() => setFlightsLoading(false));
  }, [watch, open]);

  if (!watch) {
    return <BottomSheet open={open} onClose={onClose} title=""><div /></BottomSheet>;
  }

  // === derived ===
  const target = Number(watch.max_price);
  const signal = watch.quote ? deriveSignal(watch.quote.currentBest, target) : 'watching';
  const originCity = getCity(watch.origin);
  const destCity = getCity(watch.destination);
  const days = daysUntil(watch.outbound_date);
  const subline = [
    `${watch.origin} → ${watch.destination}`,
    watch.outbound_date,
    days != null && days >= 0 ? `${days} 天後出發` : null
  ].filter(Boolean).join(' · ');

  // === handlers ===
  const handleSave = async () => {
    if (saving || !watch.id) return;
    const mp = parseInt(maxPriceStr, 10);
    if (!mp || mp <= 0) {
      setError('目標價需是正整數');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: watch.id,
          sourceId: watch.source_id,
          maxPrice: mp,
          maxPriceTraditional: tradEnabled && tradPriceStr ? parseInt(tradPriceStr, 10) : null,
          outboundMinDepartureTime: timeFilterEnabled ? (outboundMin || null) : null,
          outboundMaxDepartureTime: timeFilterEnabled ? (outboundMax || null) : null,
          returnMinDepartureTime: timeFilterEnabled ? (returnMin || null) : null,
          returnMaxDepartureTime: timeFilterEnabled ? (returnMax || null) : null,
          paused
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '儲存失敗');
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      onMutated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting || !watch.id) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/subscriptions?id=${watch.id}&sourceId=${encodeURIComponent(watch.source_id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '刪除失敗');
      onMutated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={<><span>{originCity}</span> <Icon name="airplane" size={14} style={{ transform: 'rotate(90deg)', color: 'var(--ios-blue)' }} /> <span>{destCity}</span></>}
      subtitle={subline}
    >
      {/* === Hero === */}
      <div className="hero">
        <div className="hero-left">
          <div className="hero-label">
            {watch.quote ? (watch.quote.currentType === 'lcc' ? '目前最低 · 廉航' : '目前最低 · 傳統') : '目標價'}
          </div>
          <div className="hero-price tnum">
            <span className="hp-ccy">NT$</span>
            <span className="hp-val">{ntFmt(watch.quote?.currentBest ?? target)}</span>
          </div>
          {watch.quote?.deltaPct != null && (
            <div className={`hero-delta ${watch.quote.deltaPct < 0 ? 'down' : 'up'}`}>
              <Icon name={watch.quote.deltaPct < 0 ? 'trendDown' : 'trendUp'} size={14} stroke={2.2} />
              比上週 {Math.abs(watch.quote.deltaPct).toFixed(1)}%
            </div>
          )}
        </div>
        <SignalPill signal={signal} />
      </div>

      {/* === Intel Panel (PR #5) — building 或 ready 都顯示，null 才不顯示 === */}
      {watch.quote?.intel && <IntelPanel intel={watch.quote.intel} />}

      {/* === Chart === */}
      {watch.quote && watch.quote.history.length >= 2 && (
        <div className="card chart-card">
          <div className="chart-head">
            <span className="chart-title">近 {watch.quote.history.length} 天走勢</span>
            <span className="chart-legend">
              <span className="lgd lgd-line"></span><span>價格</span>
              {watch.quote.intel?.status === 'ready' && (
                <>
                  <span className="lgd lgd-band"></span><span>典型區間</span>
                </>
              )}
              <span className="lgd lgd-target"></span><span>目標</span>
            </span>
          </div>
          <PriceChart
            history={watch.quote.history}
            target={target}
            band={watch.quote.intel?.status === 'ready'
              ? { p25: watch.quote.intel.p25, p75: watch.quote.intel.p75 }
              : null}
          />
        </div>
      )}

      {/* === Current quotes (廉航 / 傳統 split) === */}
      {(watch.quote?.lcc || watch.quote?.trad) && (
        <div className="cat-cards">
          {watch.quote?.lcc && (
            <div className="cat-card lcc">
              <div className="cat-tag">廉航</div>
              <div className="cat-airline">
                {watch.quote.lcc.ret && watch.quote.lcc.out !== watch.quote.lcc.ret
                  ? `${watch.quote.lcc.out} → ${watch.quote.lcc.ret}`
                  : watch.quote.lcc.out}
                {watch.quote.lcc.estimate && <span className="cat-est">＊估</span>}
              </div>
              <div className="cat-price tnum">NT${ntFmt(watch.quote.lcc.price)}</div>
            </div>
          )}
          {watch.quote?.trad && (
            <div className="cat-card trad">
              <div className="cat-tag">傳統</div>
              <div className="cat-airline">{watch.quote.trad.airline}</div>
              <div className="cat-price tnum">NT${ntFmt(watch.quote.trad.price)}</div>
            </div>
          )}
        </div>
      )}

      {/* === Flights (PR #4b) === */}
      {(outboundFlights.length > 0 || returnFlights.length > 0) && (
        <>
          <FlightList
            label={watch.return_date ? '去程選項' : '航班選項'}
            flights={outboundFlights}
            showAll={showAllOutbound}
            onToggleAll={() => setShowAllOutbound(v => !v)}
          />
          {watch.return_date && returnFlights.length > 0 && (
            <FlightList
              label="回程選項"
              flights={returnFlights}
              showAll={showAllReturn}
              onToggleAll={() => setShowAllReturn(v => !v)}
            />
          )}
        </>
      )}
      {flightsLoading && outboundFlights.length === 0 && (
        <div className="flights-loading">載入航班…</div>
      )}

      {/* === Per-watch settings === */}
      <div className="settings-block">
        <div className="block-head">追蹤設定</div>

        <div className="set-row">
          <span className="set-label">廉航目標價</span>
          <div className="set-amount">
            <span>NT$</span>
            <input
              type="number"
              inputMode="numeric"
              value={maxPriceStr}
              onChange={e => setMaxPriceStr(e.target.value)}
            />
          </div>
        </div>

        <div className="set-row">
          <div className="set-label-stack">
            <span>傳統航空另設</span>
            <span className="set-sublabel">星宇 / 長榮 用不同目標</span>
          </div>
          <IOSToggle on={tradEnabled} onChange={setTradEnabled} ariaLabel="傳統航空另設" />
        </div>
        {tradEnabled && (
          <div className="set-row">
            <span className="set-label set-indent">傳統航空目標價</span>
            <div className="set-amount">
              <span>NT$</span>
              <input
                type="number"
                inputMode="numeric"
                value={tradPriceStr}
                onChange={e => setTradPriceStr(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="set-row">
          <div className="set-label-stack">
            <span>起飛時段過濾</span>
            <span className="set-sublabel">只看符合的航班</span>
          </div>
          <IOSToggle on={timeFilterEnabled} onChange={setTimeFilterEnabled} ariaLabel="起飛時段過濾" />
        </div>
        {timeFilterEnabled && (
          <div className="time-windows">
            <div className="tw-leg">
              <span className="tw-leg-label">去程</span>
              <input type="time" value={outboundMin} onChange={e => setOutboundMin(e.target.value)} aria-label="去程最早" />
              <span className="tw-dash">~</span>
              <input type="time" value={outboundMax} onChange={e => setOutboundMax(e.target.value)} aria-label="去程最晚" />
            </div>
            {watch.return_date && (
              <div className="tw-leg">
                <span className="tw-leg-label">回程</span>
                <input type="time" value={returnMin} onChange={e => setReturnMin(e.target.value)} aria-label="回程最早" />
                <span className="tw-dash">~</span>
                <input type="time" value={returnMax} onChange={e => setReturnMax(e.target.value)} aria-label="回程最晚" />
              </div>
            )}
          </div>
        )}

        <div className="set-row">
          <div className="set-label-stack">
            <span>暫停追蹤</span>
            <span className="set-sublabel">暫停後不通知，仍保留設定</span>
          </div>
          <IOSToggle on={paused} onChange={setPaused} ariaLabel="暫停追蹤" />
        </div>
      </div>

      {error && (
        <div className="alert"><Icon name="warning" size={14} /> <span>{error}</span></div>
      )}

      <button type="button" className="save-cta" onClick={handleSave} disabled={saving}>
        {saving
          ? <><Icon name="hourglass" size={15} /> <span>儲存中…</span></>
          : savedFlash
            ? <><Icon name="check" size={15} /> <span>已儲存</span></>
            : <span>儲存變更</span>}
      </button>

      {/* === Delete with confirm === */}
      {!confirmDelete ? (
        <button type="button" className="delete-btn" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={15} /> <span>刪除此追蹤</span>
        </button>
      ) : (
        <div className="delete-confirm">
          <p>確定刪除這條追蹤？無法復原。</p>
          <div className="dc-actions">
            <button type="button" onClick={() => setConfirmDelete(false)} className="dc-cancel">取消</button>
            <button type="button" onClick={handleDelete} disabled={deleting} className="dc-confirm">
              {deleting ? '刪除中…' : '確認刪除'}
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .hero {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          padding: 6px 2px 14px;
          border-bottom: 0.5px solid var(--ios-hairline);
        }
        .hero-left { min-width: 0; }
        .hero-label {
          font-size: 11px;
          color: var(--ios-label-2);
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .hero-price { display: inline-flex; align-items: baseline; gap: 4px; margin-top: 2px; }
        .hp-ccy { font-size: 14px; color: var(--ios-label-2); font-weight: 600; }
        .hp-val { font-size: 36px; font-weight: 800; letter-spacing: -0.8px; color: var(--ios-label); }
        .hero-delta {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 12.5px;
          margin-top: 2px;
        }
        .hero-delta.down { color: var(--ios-green); }
        .hero-delta.up { color: var(--ios-red); }

        .card {
          background: var(--ios-bg-tertiary);
          border-radius: var(--r-card);
          padding: 12px 14px;
          margin-top: 14px;
        }
        .chart-card { background: var(--card-grad); }
        .chart-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          font-size: 12px;
          color: var(--ios-label-2);
        }
        .chart-title { font-weight: 600; color: var(--ios-label); }
        .chart-legend { display: inline-flex; gap: 6px; align-items: center; font-size: 11px; }
        .lgd {
          display: inline-block;
          width: 12px;
          height: 2px;
        }
        .lgd-line { background: var(--ios-cyan); }
        .lgd-band {
          background: var(--ios-label-3);
          opacity: 0.35;
          width: 14px;
          height: 6px;
        }
        .lgd-target {
          background: transparent;
          border-top: 2px dashed var(--ios-green);
        }

        .cat-cards {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 14px;
        }
        .cat-card {
          background: var(--ios-bg-tertiary);
          border-radius: var(--r-card);
          padding: 12px;
          border: 1px solid transparent;
        }
        .cat-card.lcc { border-color: rgba(100,210,255,0.35); }
        .cat-card.trad { border-color: rgba(255,214,10,0.35); }
        .cat-tag {
          font-size: 10px;
          font-weight: 700;
          color: var(--ios-label-3);
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .cat-card.lcc .cat-tag { color: var(--ios-cyan); }
        .cat-card.trad .cat-tag { color: var(--ios-yellow); }
        .cat-airline {
          font-size: 13px;
          color: var(--ios-label);
          font-weight: 600;
          margin-top: 4px;
        }
        .cat-est {
          font-size: 10px;
          color: var(--ios-label-3);
          margin-left: 4px;
        }
        .cat-price {
          font-size: 20px;
          font-weight: 800;
          margin-top: 4px;
          letter-spacing: -0.5px;
        }

        .settings-block {
          background: var(--ios-bg-tertiary);
          border-radius: var(--r-card);
          padding: 6px 14px;
          margin-top: 18px;
        }
        .block-head {
          font-size: 11px;
          color: var(--ios-label-3);
          letter-spacing: 1.5px;
          text-transform: uppercase;
          padding: 12px 0 6px;
        }
        .set-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 0;
          border-bottom: 0.5px solid var(--ios-hairline);
        }
        .set-row:last-child { border-bottom: none; }
        .set-label, .set-label-stack { font-size: 14px; color: var(--ios-label); flex: 1; min-width: 0; }
        .set-label-stack { display: flex; flex-direction: column; gap: 1px; }
        .set-sublabel { font-size: 11.5px; color: var(--ios-label-3); }
        .set-indent { padding-left: 10px; color: var(--ios-label-2); }
        .set-amount {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: var(--ios-bg-secondary);
          border-radius: 8px;
          padding: 6px 10px;
        }
        .set-amount span { color: var(--ios-label-2); font-size: 12px; }
        .set-amount input {
          appearance: none;
          background: transparent;
          border: none;
          color: var(--ios-label);
          font-size: 15px;
          font-weight: 700;
          font-family: var(--mono);
          width: 110px;
          text-align: right;
        }
        .set-amount input:focus { outline: none; }

        .time-windows {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 4px 0 12px;
          border-bottom: 0.5px solid var(--ios-hairline);
        }
        .tw-leg {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tw-leg-label {
          font-size: 12px;
          color: var(--ios-label-2);
          width: 38px;
        }
        .tw-leg input {
          flex: 1;
          appearance: none;
          background: var(--ios-bg-secondary);
          border: none;
          border-radius: 8px;
          color: var(--ios-label);
          padding: 8px 10px;
          font-family: var(--mono);
          font-size: 13px;
        }
        .tw-dash { color: var(--ios-label-3); }

        .alert {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255,69,58,0.15);
          color: var(--ios-red);
          padding: 10px 12px;
          border-radius: var(--r-field);
          margin-top: 14px;
          font-size: 13px;
        }
        .save-cta {
          appearance: none;
          border: none;
          background: var(--ios-blue);
          color: #fff;
          width: 100%;
          padding: 14px;
          border-radius: var(--r-field);
          font-size: 15px;
          font-weight: 700;
          margin-top: 16px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .save-cta:disabled { opacity: 0.5; cursor: not-allowed; }

        .delete-btn {
          appearance: none;
          background: transparent;
          border: 1px solid rgba(255,69,58,0.4);
          color: var(--ios-red);
          width: 100%;
          padding: 12px;
          border-radius: var(--r-field);
          font-size: 14px;
          font-weight: 600;
          margin-top: 10px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .delete-confirm {
          background: rgba(255,69,58,0.10);
          border: 1px solid rgba(255,69,58,0.4);
          border-radius: var(--r-field);
          padding: 14px;
          margin-top: 10px;
          color: var(--ios-label);
        }
        .delete-confirm p { font-size: 13px; margin: 0 0 10px; }
        .dc-actions { display: flex; gap: 8px; }
        .dc-cancel, .dc-confirm {
          flex: 1;
          appearance: none;
          border: none;
          padding: 10px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }
        .dc-cancel { background: var(--ios-fill-2); color: var(--ios-label); }
        .dc-confirm { background: var(--ios-red); color: #fff; }
        .dc-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
        .flights-loading {
          text-align: center;
          padding: 16px;
          color: var(--ios-label-3);
          font-size: 12.5px;
        }
      `}</style>
    </BottomSheet>
  );
}

/**
 * 去/回程航班 list 子元件。
 *   - 預設只顯示 top 5 + 「展開全部」連結
 *   - 第一筆 (最便宜) 加 highlight + 「最便宜」badge
 *   - airline | flight_no · HH:MM · 3h0m · 直飛 ｜ NT$ 11,480
 */
function FlightList({
  label,
  flights,
  showAll,
  onToggleAll
}: {
  label: string;
  flights: FlightRow[];
  showAll: boolean;
  onToggleAll: () => void;
}): React.ReactElement {
  const visible = showAll ? flights : flights.slice(0, TOP_N_DEFAULT);
  return (
    <div className="flight-list">
      <div className="fl-head">
        <span className="fl-title">{label}</span>
        <span className="fl-count">{flights.length} 班</span>
      </div>
      {visible.map((f, i) => (
        <div key={i} className={`fl-row ${i === 0 ? 'cheapest' : ''}`}>
          <div className="fl-left">
            <div className="fl-line1">
              <span className="fl-airline">{f.airline ?? '—'}</span>
              {f.flight_number && <span className="fl-fno tnum">{f.flight_number}</span>}
              {i === 0 && (
                <span className="fl-badge">
                  <Icon name="bolt" size={10} stroke={2.4} />
                  最便宜
                </span>
              )}
            </div>
            <div className="fl-line2">
              {f.departure_time && <span className="tnum">{f.departure_time}</span>}
              {f.departure_time && <span className="fl-sep">·</span>}
              <span className="tnum">{fmtDuration(f.duration_minutes)}</span>
              <span className="fl-sep">·</span>
              <span>直飛</span>
            </div>
          </div>
          <div className="fl-price tnum">NT${f.price?.toLocaleString() ?? '—'}</div>
        </div>
      ))}
      {flights.length > TOP_N_DEFAULT && (
        <button type="button" className="fl-expand" onClick={onToggleAll}>
          {showAll
            ? <><Icon name="chevronUp" size={12} /> <span>收合</span></>
            : <><Icon name="chevronDown" size={12} /> <span>展開全部 {flights.length} 班</span></>}
        </button>
      )}

      <style jsx>{`
        .flight-list {
          background: var(--ios-bg-tertiary);
          border-radius: var(--r-card);
          padding: 10px 14px;
          margin-top: 14px;
        }
        .fl-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 4px 0 6px;
          border-bottom: 0.5px solid var(--ios-hairline);
        }
        .fl-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--ios-label);
        }
        .fl-count {
          font-size: 11.5px;
          color: var(--ios-label-3);
        }
        .fl-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding: 10px 4px;
          border-bottom: 0.5px solid var(--ios-hairline);
        }
        .fl-row:last-of-type { border-bottom: none; }
        .fl-row.cheapest {
          background: rgba(48, 209, 88, 0.10);
          margin: 4px -10px;
          padding: 10px 10px;
          border-radius: 8px;
          border-bottom: none;
        }
        .fl-left { min-width: 0; }
        .fl-line1 {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--ios-label);
        }
        .fl-fno {
          color: var(--ios-label-2);
          font-weight: 500;
          font-size: 11.5px;
          font-family: var(--mono);
        }
        .fl-badge {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          background: var(--ios-green);
          color: #fff;
          font-size: 9.5px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 999px;
        }
        .fl-line2 {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11.5px;
          color: var(--ios-label-2);
          margin-top: 2px;
        }
        .fl-sep { color: var(--ios-label-3); }
        .fl-price {
          font-size: 15px;
          font-weight: 700;
          color: var(--ios-label);
        }
        .fl-row.cheapest .fl-price { color: var(--ios-green); }
        .fl-expand {
          appearance: none;
          background: transparent;
          border: none;
          color: var(--ios-blue);
          padding: 8px 0 2px;
          font-size: 12.5px;
          font-weight: 600;
          width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

export default WatchDetailSheet;
