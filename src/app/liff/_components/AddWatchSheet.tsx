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

/** 開口式查價回來的「一組來回組合」（去程那班 + 整趟總價）。對齊 serpapi MultiCityOption。 */
interface McOption {
  airline: string | null;
  flightNumber: string | null;
  time: string | null;
  price: number;
}
interface PreviewResult {
  lowestPrice: number | null;
  airline: string | null;
  fromCache: boolean;
  /** 開口式才有：多組來回組合，給使用者看（之後可挑）。一般路線為空。 */
  mcOptions?: McOption[];
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
  /**
   * PR #19: EmptyOnboarding 熱門航線 quick-start 用 — 開 sheet 時預填路線。
   * null = 不預填（沿用上次 / 預設 TPE→NRT）。每次 open 且有值時都套用。
   */
  prefillRoute?: { o: string; d: string } | null;
  /** 訂閱成功後通知 caller refetch watchlist */
  onCreated?: () => void;
  /**
   * 未登入時觸發 LINE 登入（liff.login → 重導 LINE OAuth → 回來帶 userId）。
   * 在外部瀏覽器開 LIFF 也能用。沒傳則未登入只顯示提示、無按鈕。
   */
  onRequestLogin?: () => void;
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** 釘選航班清單的一列（從 /api/search 回的 outbound 抽班號 + 時間）。 */
interface PinRow {
  flightNumber: string;
  airline: string;
  time: string | null;  // 'HH:MM'
  price: number;
}

/** 從 search 回的 outbound（含 raw）抽成可點選的航班列：去重(同班號留最低)、由便宜到貴。 */
function toPinRows(
  outbound: Array<{ airline?: string | null; price?: number | null; raw?: unknown }>
): PinRow[] {
  const byNum = new Map<string, PinRow>();
  for (const q of outbound) {
    const f = (q.raw as { flights?: Array<{ flight_number?: string; departure_airport?: { time?: string } }> } | undefined)?.flights?.[0];
    const fn = f?.flight_number;
    if (!fn || q.price == null) continue;
    const t = f?.departure_airport?.time;
    const time = typeof t === 'string' && t.length >= 16 ? t.slice(11, 16) : null;
    const existing = byNum.get(fn);
    if (!existing || q.price < existing.price) {
      byNum.set(fn, { flightNumber: fn, airline: q.airline ?? '—', time, price: q.price });
    }
  }
  return [...byNum.values()].sort((a, b) => a.price - b.price);
}

export function AddWatchSheet({
  open, onClose, userId, groupCtxId, defaultNotifyTarget = 'me', prefillRoute = null, onCreated, onRequestLogin
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
  // 開口式來回（0015）：回程不同地點。openJaw=true 時回段走 returnOrigin→returnDestination。
  const [openJaw, setOpenJaw] = useState(false);
  const [returnOrigin, setReturnOrigin] = useState<string>('');
  const [returnDestination, setReturnDestination] = useState<string>('');

  // === 航司過濾 ===
  // availableAirlines = 這條線實際有飛的白名單航司（route-airlines endpoint）
  // selectedAirlines  = 使用者勾的（預設全勾 = 不過濾）
  const [availableAirlines, setAvailableAirlines] = useState<string[]>([]);
  const [selectedAirlines, setSelectedAirlines] = useState<Set<string>>(new Set());

  // === preview state ===
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // === 釘選特定航班（方案 B Phase 3 複選）===
  const [flightRows, setFlightRows] = useState<PinRow[]>([]);
  // key = 班號；value = 顯示 label + 價格
  const [pinnedFlights, setPinnedFlights] = useState<Map<string, { label: string; price: number }>>(new Map());

  // === submit state ===
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PR #21 (§4.9): 成功後不默默關 sheet — 顯示 calm state（勾選描邊 + 接下來會發生什麼）
  const [done, setDone] = useState(false);

  // 每次 open 重置（避免上次殘留）+ 開啟時帶當下 defaultNotifyTarget
  // PR #19: prefillRoute 有值時套用（EmptyOnboarding 熱門航線 quick-start）
  useEffect(() => {
    if (open) {
      setError(null);
      setPreview(null);
      setFlightRows([]);
      setPinnedFlights(new Map());
      setOpenJaw(false);
      setDone(false);
      setNotifyTarget(defaultNotifyTarget);
      if (prefillRoute) {
        setOrigin(prefillRoute.o);
        setDestination(prefillRoute.d);
      }
    }
  }, [open, defaultNotifyTarget, prefillRoute]);

  // 路線 / 日期一變 → 清掉舊的航班清單 + 釘選（避免釘到別條線的班）
  useEffect(() => {
    setFlightRows([]);
    setPinnedFlights(new Map());
  }, [origin, destination, outboundDate, returnDate, isOneWay]);

  // 路線變動 → 撈這條線有飛的航司，預設全勾（純 DB 讀、不燒配額）
  useEffect(() => {
    if (!open || !origin || !destination) return;
    let cancelled = false;
    fetch(`/api/route-airlines?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`)
      .then(r => r.json())
      .then((d: { ok?: boolean; airlines?: string[] }) => {
        if (cancelled || !d.ok || !Array.isArray(d.airlines)) return;
        setAvailableAirlines(d.airlines);
        setSelectedAirlines(new Set(d.airlines));  // 預設全勾 = 不過濾
      })
      .catch(() => { /* 撈不到航司清單不擋建立流程 */ });
    return () => { cancelled = true; };
  }, [open, origin, destination]);

  const toggleAirline = (name: string) => {
    setSelectedAirlines(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  // swap 出發 / 抵達 — 確保仍維持「一台一日」
  const handleSwap = () => {
    setOrigin(destination);
    setDestination(origin);
    setPreview(null);
  };

  const jpRegions = groupJpByRegion();

  // === preview 邏輯 ===
  // 開口式：要回程兩地點都選了才能查（查價是一次 multi-city 搜尋 → 整程一張票最低總價）
  const canPreview = origin && destination && outboundDate && (isOneWay || returnDate)
    && (!openJaw || (!!returnOrigin && !!returnDestination));

  const handlePreview = async () => {
    if (!canPreview) return;
    setPreviewing(true);
    setPreview(null);
    setError(null);
    try {
      if (openJaw) {
        // 開口式：真・多城市單一票（一次 multi-city 搜尋）→ 整程最低總價
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legs: [
              { origin, destination, date: outboundDate },
              { origin: returnOrigin, destination: returnDestination, date: returnDate }
            ]
          })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '查詢失敗');
        setPreview({
          lowestPrice: data.cheapestTotal ?? null,
          airline: data.cheapestTotal != null ? `一張多城市票・${data.airline ?? '—'} 起` : null,
          fromCache: false,
          mcOptions: Array.isArray(data.options) ? (data.options as McOption[]) : []
        });
        // 開口式不沿用普通路線的釘選清單（pin-box）；改用下面的「來回組合」清單
        setFlightRows([]);
        return;
      }
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
      // 釘選用：把去程所有航班抽成可點選清單
      setFlightRows(toPinRows(data.outbound ?? []));
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

  // 使用者是否「縮小」了航司範圍（勾的 < 全部）。沒縮小 = 不過濾。
  const narrowedAirlines = availableAirlines.length > 0
    && selectedAirlines.size > 0
    && selectedAirlines.size < availableAirlines.length;

  // === 開始追蹤 ===
  // 有航司清單時至少要勾 1 家（不能 0 家 = 沒東西可追）
  const hasAirlineSelection = availableAirlines.length === 0 || selectedAirlines.size > 0;
  // 開口式：回程兩個地點都要選
  const openJawReady = !openJaw || (!!returnOrigin && !!returnDestination);
  const canSubmit = sourceId && origin && destination && outboundDate
    && (isOneWay || returnDate) && /^\d+$/.test(maxPriceStr) && parseInt(maxPriceStr, 10) > 0
    && hasAirlineSelection && openJawReady;

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
          ...(isOneWay ? {} : { returnDate }),
          // 開口式來回（0015）：回程不同地點 → 送回段 origin/destination
          ...(openJaw && !isOneWay ? { returnOrigin, returnDestination } : {}),
          // 釘選航班（複選，方案 B）：送班號陣列 + label 陣列。釘選優先 → 不送航司過濾。
          ...(pinnedFlights.size > 0
            ? {
                pinnedFlightNumbers: [...pinnedFlights.keys()],
                pinnedFlightLabels: [...pinnedFlights.values()].map(v => v.label)
              }
            // 只在「縮小範圍」時送 airlineFilter；全勾 = 不送 = 追全部（舊行為）
            : (narrowedAirlines ? { airlineFilter: [...selectedAirlines] } : {})),
          // G1: 建群組訂閱時把建立者 user 自動加入 group_member
          // 個人訂閱（sourceId 是 user）時 backend 會忽略此欄
          ...(notifyTarget === 'group' && userId ? { creatorUserId: userId } : {})
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '建立失敗');
      onCreated?.();
      // PR #21 (§4.9): 不默默關 — 切到 calm 成功畫面，user 自己按「完成」關
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="新增追蹤" subtitle="設定一條路線開始監控降價">
      {done ? (
        /* PR #21 (§4.9): add-success calm state — 勾選描邊動畫 + 接下來會發生什麼 + 完成鈕。
           動畫全 gate prefers-reduced-motion（reduce → 瞬間顯示，CSS 處理）。 */
        <div className="add-success" data-testid="add-success">
          <div className="succ-check" aria-hidden="true">
            <svg viewBox="0 0 52 52" width="72" height="72" style={{ overflow: 'visible' }}>
              <circle className="succ-ring" cx="26" cy="26" r="24" />
              <path className="succ-tick" d="M15 27 L23 35 L38 18" />
            </svg>
          </div>
          <div className="succ-title">開始追蹤了</div>
          <div className="succ-route">
            {origin}
            <Icon name="airplane" size={15} style={{ transform: 'rotate(90deg)', color: 'var(--ios-green)' }} />
            {destination}
          </div>
          <div className="succ-next">
            <div className="succ-next-row">
              <div className="succ-ni"><Icon name="chartLine" size={16} stroke={1.9} /></div>
              <span>我們會每天記錄這條航線的價格</span>
            </div>
            <div className="succ-next-row">
              <div className="succ-ni"><Icon name="target" size={16} stroke={1.9} /></div>
              <span>目標價 <strong className="tnum">NT${parseInt(maxPriceStr || '0', 10).toLocaleString()}</strong>，跌破就通知</span>
            </div>
            <div className="succ-next-row">
              <div className="succ-ni"><Icon name="bellRing" size={16} stroke={1.9} /></div>
              <span>達標時 LINE 立刻通知你</span>
            </div>
          </div>
          <button type="button" className="succ-done pressable" onClick={onClose} data-testid="add-success-done">
            <Icon name="check" size={18} stroke={2.3} />
            完成
          </button>
        </div>
      ) : !sourceId ? (
        <div className="login-gate">
          <Icon name="person" size={32} stroke={1.8} />
          <p className="login-gate-title">登入後才能建立追蹤</p>
          <p className="login-gate-sub">
            {onRequestLogin
              ? '用 LINE 登入就能新增航線、設定目標價、收到降價通知。'
              : '請在 LINE App 內開啟本頁（從 bot 選單），才能以你的身份建立追蹤。'}
          </p>
          {onRequestLogin && (
            <button type="button" className="cta login-cta" onClick={onRequestLogin} data-testid="add-login">
              使用 LINE 登入
            </button>
          )}
        </div>
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
                onClick={e => e.currentTarget.showPicker?.()}
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
                  onClick={e => e.currentTarget.showPicker?.()}
                  min={outboundDate || todayISO()}
                />
              </label>
            )}
          </div>

          {/* === 開口式來回（回程不同地點）— 只有「來回」時可開 === */}
          {!isOneWay && (
            <div className="openjaw-box">
              <button
                type="button"
                className={`openjaw-toggle ${openJaw ? 'on' : ''}`}
                data-testid="openjaw-toggle"
                onClick={() => {
                  setOpenJaw(prev => {
                    const next = !prev;
                    // 打開時帶對稱預設（回程出發=去程抵達、回程抵達=去程出發），使用者再各自改
                    if (next) {
                      setReturnOrigin(ro => ro || destination);
                      setReturnDestination(rd => rd || origin);
                    }
                    return next;
                  });
                  setPreview(null);
                }}
              >
                <Icon name={openJaw ? 'checkCircle' : 'plus'} size={14} stroke={2.2} />
                <span>回程不同地點（開口式）</span>
              </button>
              {openJaw && (
                <>
                  <div className="route-pass openjaw-pass">
                    <RouteSlot
                      label="回程出發"
                      value={returnOrigin}
                      onChange={v => { setReturnOrigin(v); setPreview(null); }}
                      twOptions={TW_ORIGINS}
                      jpRegions={jpRegions}
                    />
                    <button type="button" className="swap-btn" onClick={() => { const a = returnOrigin; setReturnOrigin(returnDestination); setReturnDestination(a); setPreview(null); }} aria-label="對調">
                      <Icon name="swap" size={18} stroke={2.2} />
                    </button>
                    <RouteSlot
                      label="回程抵達"
                      value={returnDestination}
                      onChange={v => { setReturnDestination(v); setPreview(null); }}
                      twOptions={TW_ORIGINS}
                      jpRegions={jpRegions}
                    />
                  </div>
                  <p className="openjaw-hint">開口式 = 一張多城市票（去 + 回兩段同一張機票），查價直接抓整程最低總價（不支援釘選特定航班）。</p>
                </>
              )}
            </div>
          )}

          {/* === 航司過濾（這條線有飛的才列；全勾 = 追全部）。釘選航班時隱藏（釘選優先） === */}
          {pinnedFlights.size === 0 && availableAirlines.length > 0 && (
            <div className="airline-box">
              <div className="airline-label">
                <Icon name="airplane" size={13} stroke={2} /> 航空公司
                <span className="airline-hint">只追勾選的</span>
              </div>
              <div className="airline-chips">
                {availableAirlines.map(name => {
                  const on = selectedAirlines.has(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      data-testid={`airline-${name}`}
                      className={`airline-chip ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleAirline(name)}
                    >
                      <Icon name={on ? 'check' : 'plus'} size={13} stroke={2.4} />
                      {name}
                    </button>
                  );
                })}
              </div>
              {selectedAirlines.size === 0 && (
                <div className="airline-warn">至少勾一家航空</div>
              )}
            </div>
          )}

          {/* === Preview button + result（開口式 = 一次 multi-city 搜尋，整程一張票） === */}
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
                {/* 開口式：標清這張票涵蓋「去 + 回」兩段（避免誤會成只有一個航班） */}
                {openJaw && preview.lowestPrice != null && (
                  <div className="pr-legs tnum" data-testid="pr-legs">
                    去 {origin}→{destination} · 回 {returnOrigin}→{returnDestination}
                  </div>
                )}
                <button type="button" className="pr-redo" onClick={() => setPreview(null)}>
                  重新查
                </button>

                {/* 開口式：多組「來回組合」清單（去程各班 + 整趟總價）。
                    回應 user「為何只有一筆」— 把查回來、本來只留最便宜的其他組合也列出來。 */}
                {openJaw && preview.mcOptions && preview.mcOptions.length > 0 && (
                  <div className="mc-list" data-testid="mc-list">
                    <div className="mc-head">來回組合 · {preview.mcOptions.length} 組（去程班 ＋ 整趟總價）</div>
                    {preview.mcOptions.map((o, i) => (
                      <div key={o.flightNumber ?? i} className={`mc-row ${i === 0 ? 'cheapest' : ''}`} data-testid="mc-row">
                        {i === 0 && <span className="mc-tag">最低</span>}
                        <span className="mc-air">{o.airline ?? '—'}</span>
                        {o.time && <span className="mc-time tnum">{o.time}</span>}
                        {o.flightNumber && <span className="mc-no tnum">{o.flightNumber}</span>}
                        <span className="mc-price tnum">NT${o.price.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="mc-foot">每組用「去程那班」當代表，回程系統自動配最便宜。目前追整程最低；之後可點選追特定組合。</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* === 釘選航班（方案 B 複選）：勾幾班 = 只追這幾班 === */}
          {flightRows.length > 0 && (
            <div className="pin-box">
              <div className="pin-label">
                <Icon name="airplane" size={13} stroke={2} /> 選特定航班（可複選）
                <span className="pin-hint">勾幾班＝只追這幾班；不勾＝追整條線</span>
              </div>
              <div className="pin-list">
                {flightRows.map(f => {
                  const on = pinnedFlights.has(f.flightNumber);
                  const label = f.time ? `${f.airline} · ${f.time}` : f.airline;
                  return (
                    <button
                      key={f.flightNumber}
                      type="button"
                      data-testid={`pin-${f.flightNumber}`}
                      className={`pin-row ${on ? 'on' : ''}`}
                      onClick={() => {
                        setPinnedFlights(prev => {
                          const next = new Map(prev);
                          if (next.has(f.flightNumber)) next.delete(f.flightNumber);
                          else next.set(f.flightNumber, { label, price: f.price });
                          // 目標價自動帶「勾選裡最低那班」的價
                          const prices = [...next.values()].map(v => v.price);
                          if (prices.length > 0) setMaxPriceStr(String(Math.min(...prices)));
                          return next;
                        });
                      }}
                    >
                      <Icon name={on ? 'check' : 'plus'} size={13} stroke={2.4} />
                      <span className="pin-air">{f.airline}</span>
                      <span className="pin-no tnum">{f.flightNumber}</span>
                      {f.time && <span className="pin-time tnum">{f.time}</span>}
                      <span className="pin-price tnum">NT${f.price.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
              {pinnedFlights.size > 0 && (
                <button type="button" className="pin-clearall" onClick={() => setPinnedFlights(new Map())}>
                  清除釘選（改追整條線）
                </button>
              )}
            </div>
          )}

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
            <div className="target-row-label"><Icon name="target" size={13} stroke={2} /> 目標價</div>
            {preview?.lowestPrice && (() => {
              const now = preview.lowestPrice;
              const low = Math.round(now * 0.95);
              return (
                <div className="suggest-pills">
                  <button
                    type="button"
                    data-testid="pill-current"
                    className={`tgt-pill ${maxPriceStr === String(now) ? 'active' : ''}`}
                    onClick={setTargetToCurrent}
                  >
                    <span className="tp-k">目前價</span>
                    <span className="tp-v tnum">{now.toLocaleString()}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="pill-low"
                    className={`tgt-pill ${maxPriceStr === String(low) ? 'active' : ''}`}
                    onClick={setTargetTo5pctLower}
                  >
                    <span className="tp-k">再低 5%</span>
                    <span className="tp-v tnum">{low.toLocaleString()}</span>
                  </button>
                </div>
              );
            })()}
            <div className="amount-input">
              <span className="amount-prefix">NT$</span>
              <input
                type="number"
                inputMode="numeric"
                data-testid="target-amount"
                value={maxPriceStr}
                onChange={e => setMaxPriceStr(e.target.value)}
                placeholder="自訂金額，例：12800"
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
        /* 未登入 gate：給明確的 LINE 登入入口（外部瀏覽器開也能用） */
        .login-gate {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 10px;
          padding: 32px 16px 16px;
          color: var(--ios-label-3);
        }
        .login-gate-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--ios-label);
          margin: 4px 0 0;
        }
        .login-gate-sub {
          font-size: 13px;
          line-height: 1.5;
          color: var(--ios-label-2);
          margin: 0 0 6px;
          max-width: 280px;
        }
        .login-cta { width: 100%; max-width: 280px; }
        /* ---- PR #21 add-success calm state (§4.9) ---- */
        .add-success {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 14px;
          padding: 28px 18px 12px;
        }
        .succ-check { width: 72px; height: 72px; }
        .add-success :global(.succ-ring) {
          fill: rgba(48, 209, 88, 0.12);
          stroke: var(--ios-green);
          stroke-width: 2.5;
          stroke-dasharray: 151;
          stroke-dashoffset: 151;
          animation: succ-ring-draw 0.5s cubic-bezier(0.25, 0.9, 0.35, 1) forwards;
        }
        .add-success :global(.succ-tick) {
          fill: none;
          stroke: var(--ios-green);
          stroke-width: 4;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 44;
          stroke-dashoffset: 44;
          animation: succ-tick-draw 0.32s cubic-bezier(0.5, 0, 0.5, 1) 0.42s forwards;
        }
        @keyframes succ-ring-draw { to { stroke-dashoffset: 0; } }
        @keyframes succ-tick-draw { to { stroke-dashoffset: 0; } }
        .succ-title {
          font-size: 21px;
          font-weight: 800;
          color: var(--ios-label);
          letter-spacing: -0.4px;
        }
        .succ-route {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 15px;
          font-weight: 600;
          color: var(--ios-label);
          font-family: var(--mono);
        }
        .succ-next {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          background: var(--ios-fill-3);
          border-radius: 14px;
          padding: 14px;
          text-align: left;
        }
        .succ-next-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--ios-label-2);
        }
        .succ-next-row strong { color: var(--ios-label); }
        .succ-ni {
          width: 30px;
          height: 30px;
          border-radius: 9px;
          background: rgba(48, 209, 88, 0.14);
          color: var(--ios-green);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .succ-done {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          width: 100%;
          min-height: 44px;
          background: var(--ios-green);
          color: #06351a;
          border: none;
          border-radius: 12px;
          padding: 13px;
          font-family: inherit;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          margin-top: 4px;
        }
        @media (prefers-reduced-motion: reduce) {
          .add-success :global(.succ-ring),
          .add-success :global(.succ-tick) {
            animation: none;
            stroke-dashoffset: 0;
          }
        }
        .route-pass {
          position: relative;
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--ios-bg-secondary);
          border-radius: var(--r-field);
          padding: 12px 10px;
        }
        /* 登機證撕線 — 中間一條虛線，swap 圓鈕浮在上面 */
        .route-pass::before {
          content: '';
          position: absolute;
          left: 50%;
          top: 14px;
          bottom: 14px;
          width: 0;
          border-left: 2px dashed var(--ios-separator-2);
          transform: translateX(-50%);
        }
        .swap-btn {
          position: relative;
          z-index: 1;
          appearance: none;
          background: var(--ios-bg-tertiary);
          border: 1px solid var(--ios-separator-2);
          color: var(--ios-blue);
          width: 40px;
          height: 40px;
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
          background: var(--ios-blue);
          color: #fff;
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
          cursor: pointer;
        }
        /* 深色主題下讓原生日曆 icon + 彈窗用深色（否則 icon 黑底黑、幾乎看不到） */
        :global([data-theme='dark']) .date-input input { color-scheme: dark; }
        .date-input input::-webkit-calendar-picker-indicator { cursor: pointer; }

        .openjaw-box { margin-top: 16px; }
        .openjaw-toggle {
          appearance: none;
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          background: var(--ios-fill-2);
          border: 1px solid transparent;
          border-radius: var(--r-field);
          color: var(--ios-label-2);
          font-family: inherit;
          font-size: 13.5px;
          font-weight: 600;
          padding: 11px 14px;
          cursor: pointer;
          text-align: left;
        }
        .openjaw-toggle.on { color: var(--ios-blue); border-color: var(--ios-blue); background: rgba(10, 132, 255, 0.12); }
        .openjaw-pass { margin-top: 12px; }
        .openjaw-hint {
          margin-top: 8px;
          font-size: 11.5px;
          color: var(--ios-label-3);
          line-height: 1.5;
        }

        .pin-box { margin-top: 16px; }
        .pin-clearall {
          appearance: none;
          margin-top: 8px;
          background: transparent;
          border: none;
          color: var(--ios-blue);
          font-family: inherit;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 2px;
        }
        .pin-label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 13px;
          color: var(--ios-label-2);
          margin-bottom: 8px;
        }
        .pin-hint {
          font-size: 11px;
          color: var(--ios-label-3);
          margin-left: 2px;
        }
        .pin-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 260px;
          overflow-y: auto;
        }
        .pin-row {
          appearance: none;
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          text-align: left;
          background: var(--ios-bg-tertiary);
          border: 1px solid transparent;
          border-radius: 10px;
          padding: 10px 12px;
          color: var(--ios-label);
          font-family: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .pin-row.on {
          border-color: var(--ios-blue);
          background: rgba(10, 132, 255, 0.12);
        }
        .pin-row.none { color: var(--ios-label-2); }
        .pin-air { font-weight: 600; flex-shrink: 0; }
        .pin-no {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--ios-label-3);
          flex-shrink: 0;
        }
        .pin-time {
          font-family: var(--mono);
          font-size: 12px;
          color: var(--ios-label-2);
          flex-shrink: 0;
        }
        .pin-price {
          font-family: var(--mono);
          font-weight: 700;
          margin-left: auto;
          flex-shrink: 0;
        }
        .pin-row.on .pin-price { color: var(--ios-blue); }

        .airline-box { margin-top: 16px; }
        .airline-label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 13px;
          color: var(--ios-label-2);
          margin-bottom: 8px;
        }
        .airline-hint {
          font-size: 11px;
          color: var(--ios-label-3);
          margin-left: 2px;
        }
        .airline-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .airline-chip {
          appearance: none;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: var(--ios-fill-3);
          border: 1px solid var(--ios-separator-2);
          color: var(--ios-label-2);
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .airline-chip.on {
          background: rgba(10, 132, 255, 0.14);
          border-color: var(--ios-blue);
          color: var(--ios-blue);
        }
        .airline-warn {
          margin-top: 6px;
          font-size: 12px;
          color: var(--ios-orange);
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
        .pr-legs {
          font-size: 11.5px;
          color: var(--ios-label-3);
          margin-top: 3px;
          letter-spacing: 0.2px;
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

        /* 開口式「來回組合」清單 */
        .mc-list {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 0.5px solid var(--ios-hairline);
        }
        .mc-head {
          font-size: 11px;
          color: var(--ios-label-3);
          letter-spacing: 0.3px;
          margin-bottom: 6px;
        }
        .mc-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 8px;
          border-radius: 8px;
          background: var(--ios-fill-3);
          margin-bottom: 4px;
        }
        .mc-row.cheapest { background: rgba(48, 209, 88, 0.12); }
        .mc-tag {
          font-size: 9.5px;
          font-weight: 700;
          color: var(--ios-green);
          border: 0.5px solid var(--ios-green);
          border-radius: 4px;
          padding: 0 4px;
          flex-shrink: 0;
        }
        .mc-air {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--ios-label);
        }
        .mc-time { font-size: 11.5px; color: var(--ios-label-2); }
        .mc-no { font-size: 11px; color: var(--ios-label-3); }
        .mc-price {
          margin-left: auto;
          font-size: 13px;
          font-weight: 700;
          color: var(--ios-label);
        }
        .mc-foot {
          font-size: 10.5px;
          color: var(--ios-label-3);
          line-height: 1.5;
          margin-top: 6px;
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
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 13px;
          color: var(--ios-label-2);
          margin-bottom: 8px;
        }
        .suggest-pills {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }
        .tgt-pill {
          flex: 1;
          appearance: none;
          background: var(--ios-fill-3);
          border: 1px solid var(--ios-separator-2);
          border-radius: 11px;
          padding: 8px 10px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 1px;
          text-align: left;
        }
        .tgt-pill .tp-k {
          font-size: 11px;
          color: var(--ios-label-2);
        }
        .tgt-pill .tp-v {
          font-size: 16px;
          font-weight: 700;
          color: var(--ios-label);
          font-family: var(--mono);
        }
        .tgt-pill.active {
          background: rgba(10, 132, 255, 0.14);
          border-color: var(--ios-blue);
        }
        .tgt-pill.active .tp-v { color: var(--ios-blue); }
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
      {/* 可點提示 — 讓使用者看出整塊是下拉選單（之前像純文字、不知能改） */}
      <div className="rs-hint"><Icon name="chevronDown" size={12} stroke={2.4} /> 換城市</div>
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
          background: transparent;
          border-radius: 10px;
          padding: 8px 12px;
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
          font-size: 30px;
          font-weight: 800;
          letter-spacing: -1px;
          color: var(--ios-label);
          font-family: var(--mono);
          line-height: 1.1;
        }
        .rs-city {
          font-size: 13px;
          color: var(--ios-label-2);
        }
        .rs-hint {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          margin-top: 6px;
          font-size: 11px;
          font-weight: 600;
          color: var(--ios-blue);
          background: rgba(10, 132, 255, 0.12);
          padding: 2px 8px;
          border-radius: 999px;
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
