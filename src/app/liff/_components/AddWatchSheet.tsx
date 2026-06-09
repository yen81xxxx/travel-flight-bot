'use client';

/**
 * AddWatchSheet — 點 FAB 開出來的「新增追蹤」sheet
 *
 * 設計手冊 §4.4。一張 sheet（不再像舊 3-step wizard 分頁）：
 *   - boarding-pass picker（出發 / 抵達 + swap）
 *   - 來回 / 單程 segmented
 *   - 去程 / 回程 date input（回程在單程時藏）
 *   - 即時價格預覽（user 按按鈕才打 /api/search，避免 type 一個字就打 API 燒配額）
 *   - 目標價 NT$ input + 兩個 suggestion pills（目前價 / 再低 5%）
 *   - 「開始追蹤」CTA → POST /api/subscriptions
 *
 * 後端 0 改動，全用既有 endpoint：
 *   - POST /api/search    （preview，可能燒 SerpApi 配額）
 *   - POST /api/subscriptions
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { Icon } from './Icon';
import { TW_ORIGINS, groupJpByRegion, isTaiwanAirport } from '@/config/airports';

interface PreviewResult {
  lowestPrice: number | null;
  airline: string | null;
  fromCache: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * 個人 sourceId（LIFF user.userId）— null 時無法以個人身份建立。
   * 跟 groupCtxId 兩個都有時，user 可以選通知對象。
   */
  userId: string | null;
  /**
   * 當前 LIFF session 的群組 ctx（URL ?ctx= 帶進來）— 非 null 表示在群組情境，
   * 使用者可以選把追蹤建在群組下。
   */
  groupCtxId: string | null;
  /**
   * 使用者在 Settings 設定的「新追蹤預設通知對象」(PR #4b)。
   * 'me' = 個人 / 'group' = 群組。沒設時 caller 傳 'me' 當保險預設。
   */
  defaultNotifyTarget?: 'me' | 'group';
  /** 訂閱成功後通知 caller refetch watchlist */
  onCreated?: () => void;
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);

export function AddWatchSheet({
  open, onClose, userId, groupCtxId, defaultNotifyTarget = 'me', onCreated
}: Props): React.ReactElement {
  // === 通知對象 ===
  // 只有 userId + groupCtxId 都有時，user 可選；其中一邊不存在就只能用另一邊。
  const canChooseTarget = !!userId && !!groupCtxId;
  const [notifyTarget, setNotifyTarget] = useState<'me' | 'group'>(defaultNotifyTarget);

  // === 算最終要用的 sourceId（根據選擇） ===
  const sourceId: string | null = canChooseTarget
    ? (notifyTarget === 'me' ? userId : groupCtxId)
    : (userId ?? groupCtxId);
  // === form state ===
  const [origin, setOrigin] = useState<string>('TPE');
  const [destination, setDestination] = useState<string>('NRT');
  const [isOneWay, setIsOneWay] = useState(false);
  const [outboundDate, setOutboundDate] = useState<string>('');
  const [returnDate, setReturnDate] = useState<string>('');
  const [maxPriceStr, setMaxPriceStr] = useState<string>('');

  // === preview state ===
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // === submit state ===
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每次 open 重置（避免上次殘留）+ 開啟時帶當下 defaultNotifyTarget
  useEffect(() => {
    if (open) {
      setError(null);
      setPreview(null);
      setNotifyTarget(defaultNotifyTarget);
    }
  }, [open, defaultNotifyTarget]);

  // swap 出發 / 抵達 — 確保仍維持「一台一日」
  const handleSwap = () => {
    setOrigin(destination);
    setDestination(origin);
    setPreview(null);
  };

  const jpRegions = groupJpByRegion();

  // === preview 邏輯 ===
  const canPreview = origin && destination && outboundDate && (isOneWay || returnDate);

  const handlePreview = async () => {
    if (!canPreview) return;
    setPreviewing(true);
    setPreview(null);
    setError(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          destination,
          outboundDate,
          ...(isOneWay ? {} : { returnDate })
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '查詢失敗');
      setPreview({
        lowestPrice: data.analysis?.cheapestRoundTripPrice ?? null,
        airline: data.analysis?.cheapestAirline ?? null,
        fromCache: data.fromCache === true
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  // === target price suggestion pills ===
  const setTargetToCurrent = () => {
    if (preview?.lowestPrice) setMaxPriceStr(String(preview.lowestPrice));
  };
  const setTargetTo5pctLower = () => {
    if (preview?.lowestPrice) {
      setMaxPriceStr(String(Math.round(preview.lowestPrice * 0.95)));
    }
  };

  // === 開始追蹤 ===
  const canSubmit = sourceId && origin && destination && outboundDate
    && (isOneWay || returnDate) && /^\d+$/.test(maxPriceStr) && parseInt(maxPriceStr, 10) > 0;

  const handleSubmit = async () => {
    if (!canSubmit || !sourceId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId,
          origin,
          destination,
          maxPrice: parseInt(maxPriceStr, 10),
          outboundDate,
          ...(isOneWay ? {} : { returnDate })
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '建立失敗');
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="新增追蹤" subtitle="設定一條路線開始監控降價">
      {!sourceId ? (
        <div className="hint">需要先登入 LINE 才能建立追蹤。</div>
      ) : (
        <>
          {/* === Route picker (boarding-pass style) === */}
          <div className="route-pass">
            <RouteSlot
              label="出發"
              value={origin}
              onChange={setOrigin}
              twOptions={TW_ORIGINS}
              jpRegions={jpRegions}
            />
            <button type="button" className="swap-btn" onClick={handleSwap} aria-label="對調">
              <Icon name="swap" size={18} stroke={2.2} />
            </button>
            <RouteSlot
              label="抵達"
              value={destination}
              onChange={setDestination}
              twOptions={TW_ORIGINS}
              jpRegions={jpRegions}
            />
          </div>

          {/* === Trip type === */}
          <div className="segmented">
            <button
              type="button"
              className={`seg-btn ${!isOneWay ? 'active' : ''}`}
              onClick={() => setIsOneWay(false)}
            >
              <Icon name="swap" size={14} /> <span>來回</span>
            </button>
            <button
              type="button"
              className={`seg-btn ${isOneWay ? 'active' : ''}`}
              onClick={() => setIsOneWay(true)}
            >
              <Icon name="arrowRight" size={14} /> <span>單程</span>
            </button>
          </div>

          {/* === Dates === */}
          <div className="date-row">
            <label className="date-input">
              <span className="role"><Icon name="calendar" size={12} /> 去程</span>
              <input
                type="date"
                value={outboundDate}
                onChange={e => { setOutboundDate(e.target.value); setPreview(null); }}
                min={todayISO()}
              />
            </label>
            {!isOneWay && (
              <label className="date-input">
                <span className="role"><Icon name="calendar" size={12} /> 回程</span>
                <input
                  type="date"
                  value={returnDate}
                  onChange={e => { setReturnDate(e.target.value); setPreview(null); }}
                  min={outboundDate || todayISO()}
                />
              </label>
            )}
          </div>

          {/* === Preview button + result === */}
          <div className="preview-box">
            {!preview ? (
              <button
                type="button"
                className="preview-btn"
                onClick={handlePreview}
                disabled={!canPreview || previewing}
              >
                {previewing
                  ? <><Icon name="hourglass" size={14} /> <span>查詢中…</span></>
                  : <><Icon name="search" size={14} /> <span>查目前最低價</span></>}
              </button>
            ) : (
              <div className="preview-result">
                <div className="pr-label">目前最低{preview.fromCache && <span className="pr-cache">· 6h 快取</span>}</div>
                <div className="pr-val tnum">
                  {preview.lowestPrice != null ? `NT$ ${preview.lowestPrice.toLocaleString()}` : '查無資料'}
                </div>
                {preview.airline && <div className="pr-airline">{preview.airline}</div>}
                <button type="button" className="pr-redo" onClick={() => setPreview(null)}>
                  重新查
                </button>
              </div>
            )}
          </div>

          {/* === Notify target picker (PR #4b) — 只有 user 同時在群組情境才出現 === */}
          {canChooseTarget && (
            <div className="notify-target">
              <div className="nt-label">通知對象</div>
              <div className="nt-segmented">
                <button
                  type="button"
                  className={notifyTarget === 'me' ? 'nt-seg active' : 'nt-seg'}
                  onClick={() => setNotifyTarget('me')}
                  data-testid="notify-target-me"
                >
                  <Icon name="person" size={13} stroke={2} /> 通知我
                </button>
                <button
                  type="button"
                  className={notifyTarget === 'group' ? 'nt-seg active' : 'nt-seg'}
                  onClick={() => setNotifyTarget('group')}
                  data-testid="notify-target-group"
                >
                  <Icon name="people" size={13} stroke={2} /> 通知群組
                </button>
              </div>
            </div>
          )}

          {/* === Target price === */}
          <div className="target-box">
            <div className="target-row-label">目標價</div>
            {preview?.lowestPrice && (
              <div className="suggest-pills">
                <button type="button" onClick={setTargetToCurrent}>
                  目前價 NT${preview.lowestPrice.toLocaleString()}
                </button>
                <button type="button" onClick={setTargetTo5pctLower}>
                  再低 5%
                </button>
              </div>
            )}
            <div className="amount-input">
              <span className="amount-prefix">NT$</span>
              <input
                type="number"
                inputMode="numeric"
                value={maxPriceStr}
                onChange={e => setMaxPriceStr(e.target.value)}
                placeholder="例：12800"
              />
            </div>
          </div>

          {error && (
            <div className="alert"><Icon name="warning" size={14} /> <span>{error}</span></div>
          )}

          <button
            type="button"
            className="cta"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
          >
            {submitting
              ? <><Icon name="hourglass" size={15} /> <span>建立中…</span></>
              : <><Icon name="bell" size={15} /> <span>開始追蹤</span></>}
          </button>
        </>
      )}

      <style jsx>{`
        .hint { padding: 32px 8px; text-align: center; color: var(--ios-label-2); }
        .route-pass {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--ios-fill-3);
          border-radius: var(--r-field);
          padding: 14px 12px;
        }
        .swap-btn {
          appearance: none;
          background: var(--ios-fill-2);
          border: none;
          color: var(--ios-blue);
          width: 32px;
          height: 32px;
          border-radius: 50%;
          flex-shrink: 0;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .segmented {
          display: flex;
          gap: 6px;
          background: var(--ios-fill-2);
          padding: 4px;
          border-radius: var(--r-pill);
          margin-top: 14px;
        }
        .seg-btn {
          flex: 1;
          appearance: none;
          background: transparent;
          border: none;
          color: var(--ios-label-2);
          padding: 9px 12px;
          border-radius: var(--r-pill);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }
        .seg-btn.active {
          background: var(--ios-bg-secondary);
          color: var(--ios-label);
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }

        .date-row {
          display: flex;
          gap: 10px;
          margin-top: 14px;
        }
        .date-input { flex: 1; display: flex; flex-direction: column; gap: 4px; }
        .role {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11.5px;
          color: var(--ios-label-2);
        }
        .date-input input {
          appearance: none;
          background: var(--ios-fill-2);
          border: none;
          border-radius: var(--r-field);
          color: var(--ios-label);
          font-size: 14px;
          font-family: var(--mono);
          padding: 11px 12px;
        }

        .preview-box { margin-top: 16px; }
        .preview-btn {
          appearance: none;
          background: var(--ios-fill-2);
          border: 1px dashed var(--ios-hairline);
          color: var(--ios-blue);
          width: 100%;
          padding: 13px;
          border-radius: var(--r-field);
          font-size: 14px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
        }
        .preview-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .preview-result {
          background: linear-gradient(180deg, rgba(10,132,255,0.10) 0%, rgba(10,132,255,0.02) 100%);
          border: 1px solid rgba(10,132,255,0.25);
          padding: 12px 14px;
          border-radius: var(--r-field);
          position: relative;
        }
        .pr-label {
          font-size: 11px;
          color: var(--ios-label-2);
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .pr-cache {
          margin-left: 6px;
          color: var(--ios-label-3);
          text-transform: none;
          letter-spacing: 0;
          font-size: 10px;
        }
        .pr-val {
          font-size: 22px;
          font-weight: 800;
          color: var(--ios-label);
          margin-top: 2px;
          letter-spacing: -0.4px;
        }
        .pr-airline {
          font-size: 12px;
          color: var(--ios-label-2);
        }
        .pr-redo {
          position: absolute;
          top: 10px;
          right: 10px;
          background: transparent;
          border: none;
          color: var(--ios-blue);
          font-size: 12px;
          cursor: pointer;
        }

        .notify-target {
          margin-top: 18px;
        }
        .nt-label {
          font-size: 13px;
          color: var(--ios-label-2);
          margin-bottom: 8px;
        }
        .nt-segmented {
          display: flex;
          gap: 6px;
          background: var(--ios-fill-2);
          padding: 4px;
          border-radius: var(--r-pill);
        }
        .nt-seg {
          flex: 1;
          appearance: none;
          background: transparent;
          border: none;
          color: var(--ios-label-2);
          padding: 9px 12px;
          border-radius: var(--r-pill);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }
        .nt-seg.active {
          background: var(--ios-bg-secondary);
          color: var(--ios-label);
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        .target-box { margin-top: 18px; }
        .target-row-label {
          font-size: 13px;
          color: var(--ios-label-2);
          margin-bottom: 8px;
        }
        .suggest-pills {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        .suggest-pills button {
          appearance: none;
          background: var(--ios-fill-2);
          border: none;
          color: var(--ios-label);
          padding: 7px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .amount-input {
          display: flex;
          align-items: center;
          background: var(--ios-fill-2);
          border-radius: var(--r-field);
          padding: 0 12px;
        }
        .amount-prefix {
          color: var(--ios-label-2);
          font-size: 13px;
          font-weight: 600;
          padding-right: 8px;
        }
        .amount-input input {
          flex: 1;
          appearance: none;
          background: transparent;
          border: none;
          color: var(--ios-label);
          font-size: 17px;
          font-weight: 700;
          padding: 13px 0;
          font-family: var(--mono);
          width: 100%;
        }
        .amount-input input:focus { outline: none; }

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

        .cta {
          appearance: none;
          border: none;
          background: var(--ios-blue);
          color: #fff;
          width: 100%;
          padding: 14px;
          border-radius: var(--r-field);
          font-size: 15px;
          font-weight: 700;
          margin-top: 18px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .cta:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </BottomSheet>
  );
}

/**
 * 路線單格（出發 or 抵達）— 大 IATA 碼 + select overlay。
 * select 直接覆蓋整格、opacity 0，按下時 OS native picker 出現。
 */
function RouteSlot({
  label,
  value,
  onChange,
  twOptions,
  jpRegions
}: {
  label: string;
  value: string;
  onChange: (iata: string) => void;
  twOptions: { iata: string; city: string; name: string }[];
  jpRegions: Record<string, { iata: string; city: string; name: string }[]>;
}): React.ReactElement {
  const cityAirport = twOptions.find(a => a.iata === value);
  const jpAirport = Object.values(jpRegions).flat().find(a => a.iata === value);
  const display = cityAirport ?? jpAirport;
  const isTW = isTaiwanAirport(value);

  return (
    <div className="rs">
      <div className="rs-label">{label}</div>
      <div className="rs-code">{value}</div>
      <div className="rs-city">{display ? `${display.city}` : value}</div>
      <select
        className="rs-select"
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
      >
        <optgroup label="台灣">
          {twOptions.map(a => <option key={a.iata} value={a.iata}>{a.iata} · {a.city} ({a.name})</option>)}
        </optgroup>
        {Object.entries(jpRegions).map(([region, list]) => (
          <optgroup key={region} label={`日本 · ${region}`}>
            {list.map(a => <option key={a.iata} value={a.iata}>{a.iata} · {a.city} ({a.name})</option>)}
          </optgroup>
        ))}
      </select>
      <style jsx>{`
        .rs {
          position: relative;
          flex: 1;
          background: var(--ios-bg-secondary);
          border-radius: 10px;
          padding: 10px 12px;
          text-align: ${isTW ? 'left' : 'right'};
          min-width: 0;
        }
        .rs-label {
          font-size: 10px;
          color: var(--ios-label-3);
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .rs-code {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -1px;
          color: var(--ios-label);
          font-family: var(--mono);
          line-height: 1.1;
        }
        .rs-city {
          font-size: 12px;
          color: var(--ios-label-2);
        }
        .rs-select {
          position: absolute;
          inset: 0;
          appearance: none;
          background: transparent;
          color: transparent;
          opacity: 0;
          border: none;
          cursor: pointer;
          font-size: 16px; /* 避免 iOS 在 <16px 時 zoom */
        }
        .rs-select option {
          background: var(--ios-bg-secondary);
          color: var(--ios-label);
        }
      `}</style>
    </div>
  );
}

export default AddWatchSheet;
