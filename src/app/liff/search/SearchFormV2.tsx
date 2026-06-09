'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Airport } from '@/config/airports';
import { isTaiwanAirport, isJapanAirport } from '@/config/airports';
import { useForm } from '@/hooks/useForm';
import { useLiff } from '@/hooks/useLiff';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { useSearchSession } from '@/hooks/useSearchSession';
import { Stepper } from '@/components/Stepper';
import TabNav from '../TabNav';
import { Icon } from '../_components/Icon';

interface Props {
  liffId: string;
  twAirports: Airport[];
  jpAirports: Airport[];
}

// === 顯示用 helpers ===
function fmtTime(s: string | undefined): string {
  if (!s) return '';
  const m = s.match(/(\d{2}:\d{2})/);
  return m ? m[1] : '';
}
function fmtDur(min: number | null | undefined): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}

/**
 * 顯示單程候選 list（去程 or 回程）。
 * 預設只顯示前 3 班（最便宜），按「看全部 X 班」展開。
 */
function FlightList({ legLabel, flights }: { legLabel: React.ReactNode; flights: FlightRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...flights].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const shown = expanded ? sorted : sorted.slice(0, 3);
  const cheapest = sorted[0]?.price;

  if (sorted.length === 0) return null;

  return (
    <div className="flight-list">
      <div className="fl-title">{legLabel}</div>
      {shown.map((f, i) => {
        const leg = f.raw?.flights?.[0];
        const dep = fmtTime(leg?.departure_airport?.time);
        const arr = fmtTime(leg?.arrival_airport?.time);
        const isCheapest = f.price === cheapest && f.price != null;
        return (
          <div key={i} className={`fl-row ${isCheapest ? 'cheapest' : ''}`}>
            <div className="fl-left">
              <div className="fl-airline">
                {f.airline ?? '—'}
                {leg?.flight_number && <span className="fl-fn">{leg.flight_number}</span>}
                {isCheapest && <span className="fl-badge">最便宜</span>}
              </div>
              <div className="fl-time">
                {dep && arr ? (
                  <>
                    <span className="fl-t">{dep}</span>
                    <span className="fl-arrow">→</span>
                    <span className="fl-t">{arr}</span>
                    <span className="fl-meta">· {fmtDur(f.duration_minutes)} · {f.stops === 0 ? '直飛' : `${f.stops} 停`}</span>
                  </>
                ) : (
                  <span className="fl-meta">{fmtDur(f.duration_minutes)} · {f.stops === 0 ? '直飛' : `${f.stops} 停`}</span>
                )}
              </div>
            </div>
            <div className="fl-price">NT$ {f.price?.toLocaleString() ?? '—'}</div>
          </div>
        );
      })}
      {sorted.length > 3 && (
        <button
          type="button"
          className="fl-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? `▲ 收合` : `▼ 看全部 ${sorted.length} 班`}
        </button>
      )}
    </div>
  );
}

interface SerpFlightLegRaw {
  airline?: string;
  flight_number?: string;
  airplane?: string;
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  duration?: number;
}
interface SerpFlightRaw {
  flights?: SerpFlightLegRaw[];
  total_duration?: number;
}
interface FlightRow {
  airline: string | null;
  price: number | null;
  duration_minutes: number | null;
  stops: number;
  flight_type: 'best' | 'other';
  raw?: SerpFlightRaw;
}

interface SearchResponse {
  ok: boolean;
  outbound?: FlightRow[];
  return?: FlightRow[];
  analysis?: {
    cheapestRoundTripPrice: number | null;
    cheapestAirline: string | null;
    outboundCount: number;
    returnCount: number;
    cheapestOutbound?: FlightRow | null;
    cheapestReturn?: FlightRow | null;
    traditionalRoundTrip?: { airline: string; price: number } | null;
    lccCombo?: { outboundAirline: string; returnAirline: string; price: number; isEstimate?: boolean } | null;
  };
  fromCache?: boolean;
  error?: string;
}

export default function SearchFormV2({ liffId, twAirports, jpAirports }: Props) {
  // LIFF 狀態管理
  const { liffReady, user, login: handleLineLogin } = useLiff(liffId);
  const sourceId = user?.userId ?? null;
  const profileName = user?.displayName ?? null;

  // 群組上下文
  const [groupCtxId, setGroupCtxId] = useSessionStorage<string | null>('liff_ctx', null);

  // 會話管理（3步流程）
  const session = useSearchSession();

  // 搜尋表單狀態
  const searchForm = useForm(
    { origin: session.state.origin, destination: session.state.destination, outboundDate: session.state.outboundDate, returnDate: session.state.returnDate }
  );

  // 訂閱表單狀態
  const subscribeForm = useForm(
    { customMaxPrice: session.state.customMaxPrice, subLabel: session.state.subLabel }
  );
  // 「傳統航空另設目標價」可選
  const [enableTradTarget, setEnableTradTarget] = useState(false);
  const [tradMaxPrice, setTradMaxPrice] = useState('');
  // 單程訂閱：勾選後隱藏回程日期、搜尋/訂閱都不帶 returnDate
  const [isOneWay, setIsOneWay] = useState<boolean>(session.state.isOneWay);

  // API 狀態 — result 用 session.state.searchResult 當初始值，這樣 LIFF 登入完 reload
  // 回來時 Step 2 / Step 3 還能看到上次的搜尋結果（之前會空白卡因為 result=null）
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(
    (session.state.searchResult as SearchResponse | undefined) ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [subscribeAs, setSubscribeAs] = useState<'self' | 'group'>(session.state.subscribeAs);

  // 預設日期 — 如果 session 已有日期就用 session 的，沒有才填預設
  useEffect(() => {
    if (!searchForm.values.outboundDate) {
      const now = new Date();
      const out = new Date(now.getTime() + 30 * 86400_000);
      const ret = new Date(out.getTime() + 4 * 86400_000);
      searchForm.setValue('outboundDate', out.toISOString().slice(0, 10));
      searchForm.setValue('returnDate', ret.toISOString().slice(0, 10));
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // 從 URL 讀 ctx
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get('ctx');
    if (ctx && (ctx.startsWith('C') || ctx.startsWith('R'))) {
      setGroupCtxId(ctx);
    }
  }, [setGroupCtxId]);

  // 日本機場分組
  const jpByRegion = useMemo(() => {
    const groups: Record<string, Airport[]> = {};
    for (const d of jpAirports) {
      const r = d.region ?? '其他';
      (groups[r] = groups[r] ?? []).push(d);
    }
    return groups;
  }, [jpAirports]);

  // 機場選項
  const renderAirportOptions = () => (
    <>
      <optgroup label="台灣">
        {twAirports.map(a => (
          <option key={a.iata} value={a.iata}>
            {a.city} {a.iata}
          </option>
        ))}
      </optgroup>
      {Object.entries(jpByRegion).map(([region, list]) => (
        <optgroup key={region} label={`日本 · ${region}`}>
          {list.map(a => (
            <option key={a.iata} value={a.iata}>
              {a.city} {a.iata}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );

  // Step 1: 驗證和提交搜尋
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { origin, destination, outboundDate, returnDate } = searchForm.values;

    // 方向驗證
    if (!((isTaiwanAirport(origin) && isJapanAirport(destination)) || (isJapanAirport(origin) && isTaiwanAirport(destination)))) {
      setError('出發地與目的地必須一個在台灣、一個在日本');
      return;
    }

    // 日期驗證
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out = new Date(outboundDate);

    if (isNaN(out.getTime())) {
      setError('去程日期格式錯誤');
      return;
    }
    if (out < today) {
      setError('去程日期不能在過去');
      return;
    }

    // 來回才檢查回程
    if (!isOneWay) {
      const ret = new Date(returnDate);
      if (isNaN(ret.getTime())) {
        setError('回程日期格式錯誤');
        return;
      }
      if (ret <= out) {
        setError('回程日期必須晚於去程日期');
        return;
      }
      const tripDays = Math.round((ret.getTime() - out.getTime()) / 86400_000);
      if (tripDays > 60) {
        const ok = confirm(`旅程長度 ${tripDays} 天，超過 60 天可能查無資料。確定要查嗎？`);
        if (!ok) return;
      }
    }

    const aheadDays = Math.round((out.getTime() - today.getTime()) / 86400_000);
    if (aheadDays > 330) {
      setError('出發日期太遠，通常還沒開放訂位');
      return;
    }

    // 搜尋
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin, destination, outboundDate,
          // 單程：完全不送 returnDate；後端 searchFlights 視為單程
          ...(isOneWay ? {} : { returnDate }),
          sourceId: groupCtxId ? undefined : (sourceId ?? undefined)
        })
      });

      const data: SearchResponse = await res.json();
      if (!data.ok) throw new Error(data.error || '搜尋失敗');

      setResult(data);
      session.updateSession({
        origin, destination, outboundDate, returnDate, isOneWay,
        searchResult: data
      });

      // 預設訂閱價格
      if (data.analysis?.cheapestRoundTripPrice) {
        subscribeForm.setValue('customMaxPrice', String(data.analysis.cheapestRoundTripPrice));
      }

      // 進入 Step 2
      session.nextStep();
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜尋失敗');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: 訂閱
  const handleSubscribe = async () => {
    if (subscribeStatus === 'saving') return;
    if (!sourceId) {
      setError('需要在 LINE 內開啟才能訂閱');
      return;
    }

    const userInputPrice = parseFloat(subscribeForm.values.customMaxPrice);
    if (isNaN(userInputPrice) || userInputPrice <= 0) {
      setError('請輸入有效的金額');
      return;
    }

    // 傳統另設目標價（可選）
    let tradPrice: number | null = null;
    if (enableTradTarget) {
      const t = parseFloat(tradMaxPrice);
      if (isNaN(t) || t <= 0) {
        setError('傳統目標價請輸入有效金額（或關閉「另設」）');
        return;
      }
      tradPrice = t;
    }

    setSubscribeStatus('saving');
    try {
      const { origin, destination, outboundDate, returnDate } = searchForm.values;
      const targetSourceId = subscribeAs === 'group' && groupCtxId ? groupCtxId : sourceId;

      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: targetSourceId,
          origin, destination,
          maxPrice: userInputPrice,
          maxPriceTraditional: tradPrice,
          outboundDate,
          // 單程訂閱不送 returnDate；後端 schema returnDate 是 optional
          ...(isOneWay ? {} : { returnDate }),
          label: subscribeForm.values.subLabel.trim() || undefined
        })
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '訂閱失敗');

      setSubscribeStatus('saved');
      session.nextStep();
    } catch (err) {
      setSubscribeStatus('error');
      setError(err instanceof Error ? err.message : '訂閱失敗');
    }
  };

  const closeLiff = async () => {
    if (!liffId) return;
    try {
      const liff = (await import('@line/liff')).default;
      if (liff.isInClient()) liff.closeWindow();
    } catch (err) {
      console.warn('closeLiff failed:', err);
    }
  };

  const fmt = (n: number | null | undefined) =>
    n != null ? `NT$ ${n.toLocaleString()}` : '—';

  if (!liffReady) {
    return (
      <div className="liff-loading">
        <div className="spinner" />
        <p>載入中…</p>
        <style jsx>{`
          .liff-loading {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
            color: #7e88a8;
          }
          .spinner {
            width: 40px; height: 40px;
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top-color: #ff7a45;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <>
      <TabNav active="search" liffId={liffId} />
      <div className="wrap">
        <header className="hero">
          <span className="logo"><Icon name="airplane" size={28} /></span>
          <div>
            <h1>機票查詢</h1>
            <p className="hi-line">
              {profileName ? <>Hi, {profileName} <Icon name="waveHand" size={14} /></> : '台灣 → 日本'}
            </p>
          </div>
        </header>

        {/* 進度指示器 */}
        <Stepper
          steps={['路線日期', '查詢結果', '確認訂閱']}
          currentStep={session.state.step}
          onStepClick={i => {
            if (i < session.state.step) session.goToStep(i);
          }}
        />

        {/* Step 1: 搜尋表單 */}
        {session.state.step === 0 && (
          <form onSubmit={handleSearchSubmit} className="card form">
            <div className="route-display">
              <div className="airport-pick">
                <span className="role">出發</span>
                <div className="airport-display">
                  <select
                    value={searchForm.values.origin}
                    onChange={e => searchForm.setValue('origin', e.target.value)}
                    disabled={loading}
                    className="picker"
                  >
                    {renderAirportOptions()}
                  </select>
                  <div className="airport-code">
                    {searchForm.values.origin?.slice(0, 3).toUpperCase() || 'TPE'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="swap-btn"
                onClick={() => {
                  const temp = searchForm.values.origin;
                  searchForm.setValue('origin', searchForm.values.destination);
                  searchForm.setValue('destination', temp);
                }}
                disabled={loading}
              >
                ⇅
              </button>

              <div className="airport-pick">
                <span className="role">目的地</span>
                <div className="airport-display">
                  <select
                    value={searchForm.values.destination}
                    onChange={e => searchForm.setValue('destination', e.target.value)}
                    disabled={loading}
                    className="picker"
                  >
                    {renderAirportOptions()}
                  </select>
                  <div className="airport-code">
                    {searchForm.values.destination?.slice(0, 3).toUpperCase() || 'NRT'}
                  </div>
                </div>
              </div>
            </div>

            {/* 來回 / 單程 切換 */}
            <div className="trip-type-row">
              <button
                type="button"
                className={`trip-type-btn ${!isOneWay ? 'active' : ''}`}
                onClick={() => setIsOneWay(false)}
                disabled={loading}
              >
                <Icon name="swap" size={16} /> 來回
              </button>
              <button
                type="button"
                className={`trip-type-btn ${isOneWay ? 'active' : ''}`}
                onClick={() => setIsOneWay(true)}
                disabled={loading}
              >
                <Icon name="arrowRight" size={16} /> 單程
              </button>
            </div>

            <div className="date-row">
              <label className="date-input">
                <span className="role"><Icon name="calendar" size={13} /> 去程</span>
                <input
                  type="date"
                  value={searchForm.values.outboundDate}
                  onChange={e => searchForm.setValue('outboundDate', e.target.value)}
                  required
                  disabled={loading}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </label>
              {!isOneWay && (
                <label className="date-input">
                  <span className="role"><Icon name="calendar" size={13} /> 回程</span>
                  <input
                    type="date"
                    value={searchForm.values.returnDate}
                    onChange={e => searchForm.setValue('returnDate', e.target.value)}
                    required
                    disabled={loading}
                    min={searchForm.values.outboundDate || new Date().toISOString().slice(0, 10)}
                  />
                </label>
              )}
            </div>

            {error && <div className="alert alert-error"><Icon name="warning" size={16} /> <span>{error}</span></div>}

            <button type="submit" disabled={loading} className="btn-primary">
              {loading
                ? <><Icon name="hourglass" size={16} /> <span>查詢中…</span></>
                : <><Icon name="search" size={16} /> <span>查詢航班</span></>}
            </button>
          </form>
        )}

        {/* Step 2: 搜尋結果 */}
        {/* Step 2 但沒 result（例如 LIFF 登入後 session corrupt 或 result fetch 失敗）→ 引導回 Step 1 */}
        {session.state.step === 1 && (!result || !result.ok) && (
          <div className="card">
            <div className="empty-state">
              <p><Icon name="clock" size={16} /> <span>搜尋結果已過期</span></p>
              <p className="empty-hint">回到第 1 步重新查詢一次</p>
              <button onClick={() => session.previousStep()} className="btn-secondary">
                <Icon name="chevronLeft" size={14} /> <span>回去查航班</span>
              </button>
            </div>
          </div>
        )}

        {session.state.step === 1 && result && result.ok && (
          <div className="card results-card">
            <h2><Icon name="airplane" size={18} /> <span>搜尋結果</span></h2>

            {result.analysis?.outboundCount === 0 ? (
              <div className="empty-state">
                <p><Icon name="close" size={16} /> <span>找不到符合條件的直飛航班</span></p>
                <p className="empty-hint">監控航司：星宇 / 長榮 / 捷星 / 酷航。可試其他日期或機場（例：HND 改 NRT 通常選項較多）</p>
                <button onClick={() => session.previousStep()} className="btn-secondary">
                  <Icon name="chevronLeft" size={14} /> <span>修改條件</span>
                </button>
              </div>
            ) : (
              <>
                {/* 摘要列：找到 N 班 + 最便宜 */}
                <div className="result-summary">
                  <div className="summary-line">
                    <span className="summary-num">{result.analysis?.outboundCount ?? 0}</span>
                    <span className="summary-text">個{isOneWay ? '單程' : '直飛'}選項</span>
                    {!isOneWay && result.analysis && (
                      <>
                        <span className="summary-sep">·</span>
                        <span className="summary-num">{result.analysis.returnCount ?? 0}</span>
                        <span className="summary-text">回程選項</span>
                      </>
                    )}
                  </div>
                  <div className="summary-cheapest">
                    {isOneWay ? '最便宜單程' : '最便宜往返'} <strong className="accent">{fmt(result.analysis?.cheapestRoundTripPrice)}</strong>
                  </div>
                </div>

                {/* 廉航 vs 傳統 對比卡 */}
                <div className="category-cards">
                  {result.analysis?.lccCombo && (
                    <div className="cat-card lcc">
                      <div className="cat-header">
                        <span className="cat-tag lcc-tag">廉航</span>
                        <span className="cat-airline">
                          {result.analysis.lccCombo.outboundAirline === result.analysis.lccCombo.returnAirline
                            ? result.analysis.lccCombo.outboundAirline
                            : `${result.analysis.lccCombo.outboundAirline} → ${result.analysis.lccCombo.returnAirline}`}
                        </span>
                        {result.analysis.lccCombo.isEstimate && <span className="cat-est" title="去程估算，實際訂購可能差幾百元">＊估</span>}
                      </div>
                      <div className="cat-price lcc">{fmt(result.analysis.lccCombo.price)}</div>
                    </div>
                  )}
                  {result.analysis?.traditionalRoundTrip && (
                    <div className="cat-card trad">
                      <div className="cat-header">
                        <span className="cat-tag trad-tag">傳統</span>
                        <span className="cat-airline">{result.analysis.traditionalRoundTrip.airline}</span>
                      </div>
                      <div className="cat-price trad">{fmt(result.analysis.traditionalRoundTrip.price)}</div>
                    </div>
                  )}
                </div>

                {/* 去程 list */}
                <FlightList
                  legLabel={
                    isOneWay
                      ? <><Icon name="airplane" size={14} /> <span>航班選項</span></>
                      : <><Icon name="takeoff" size={14} /> <span>去程選項</span></>
                  }
                  flights={result.outbound ?? []}
                />

                {/* 回程 list — 來回才顯示 */}
                {!isOneWay && (result.return?.length ?? 0) > 0 && (
                  <FlightList
                    legLabel={<><Icon name="landing" size={14} /> <span>回程選項</span></>}
                    flights={result.return ?? []}
                  />
                )}

                {/* 缓存 hint */}
                {result.fromCache && (
                  <div className="cache-hint"><Icon name="box" size={13} /> <span>此為近 6 小時內快取資料</span></div>
                )}

                {/* CTA */}
                {sourceId ? (
                  <button onClick={() => session.nextStep()} className="btn-primary">
                    <Icon name="bell" size={16} /> <span>確認價格，進入訂閱</span> <Icon name="arrowRight" size={14} />
                  </button>
                ) : (
                  <button onClick={handleLineLogin} className="btn-line-login">
                    <span>L</span>
                    <span>用 LINE 登入以訂閱</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 3: 確認訂閱 */}
        {session.state.step === 2 && result && sourceId && (
          <div className="card subscribe-card">
            <h2><Icon name="bell" size={18} /> <span>確認訂閱</span></h2>

            <div className="sub-input-row">
              <span className="sub-prefix">NT$</span>
              <input
                type="number"
                value={subscribeForm.values.customMaxPrice}
                onChange={e => subscribeForm.setValue('customMaxPrice', e.target.value)}
                placeholder="主目標價（廉航 + 傳統 fallback）"
                disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved'}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#94a3b8', marginTop: 8, marginBottom: enableTradTarget ? 4 : 8 }}>
              <input
                type="checkbox"
                checked={enableTradTarget}
                onChange={e => setEnableTradTarget(e.target.checked)}
                disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved'}
              />
              傳統航空（星宇 / 長榮）另設目標價
            </label>
            {enableTradTarget && (
              <div className="sub-input-row" style={{ marginBottom: 8 }}>
                <span className="sub-prefix">NT$</span>
                <input
                  type="number"
                  value={tradMaxPrice}
                  onChange={e => setTradMaxPrice(e.target.value)}
                  placeholder="傳統航空目標價（例 28,000）"
                  disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved'}
                />
              </div>
            )}

            <input
              type="text"
              value={subscribeForm.values.subLabel}
              onChange={e => subscribeForm.setValue('subLabel', e.target.value)}
              placeholder="備註（選填）"
              disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved'}
              maxLength={50}
              className="sub-label-input"
            />

            {groupCtxId && (
              <div className="toggle-group">
                <button
                  type="button"
                  className={subscribeAs === 'self' ? 'tg active' : 'tg'}
                  onClick={() => setSubscribeAs('self')}
                >
                  <Icon name="person" size={15} /> <span>通知我</span>
                </button>
                <button
                  type="button"
                  className={subscribeAs === 'group' ? 'tg active' : 'tg'}
                  onClick={() => setSubscribeAs('group')}
                >
                  <Icon name="people" size={15} /> <span>通知群組</span>
                </button>
              </div>
            )}

            {error && <div className="alert alert-error"><Icon name="warning" size={16} /> <span>{error}</span></div>}

            {subscribeStatus === 'saved' ? (
              <div className="success-state">
                <div className="big"><Icon name="party" size={48} /></div>
                <p>訂閱成功！跌破 NT$ {subscribeForm.values.customMaxPrice} 會自動通知。</p>
                <button onClick={closeLiff} className="btn-primary">
                  關閉
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleSubscribe}
                  disabled={subscribeStatus === 'saving' || !subscribeForm.values.customMaxPrice}
                  className="btn-primary"
                >
                  {subscribeStatus === 'saving'
                    ? <><Icon name="hourglass" size={16} /> <span>訂閱中…</span></>
                    : <><Icon name="check" size={16} /> <span>確認訂閱</span></>}
                </button>
                <button onClick={() => session.previousStep()} className="btn-secondary">
                  <Icon name="chevronLeft" size={14} /> <span>回上一步</span>
                </button>
              </>
            )}
          </div>
        )}

        <style jsx>{`
          .wrap {
            max-width: 640px;
            margin: 0 auto;
            padding: 16px;
            padding-bottom: 80px;
            font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Microsoft JhengHei', sans-serif;
            background: linear-gradient(180deg, #f8f9fa 0%, #ffffff 100%);
          }

          .hero {
            background: linear-gradient(135deg, #001a4d 0%, #1a3a66 100%);
            border-radius: 16px;
            padding: 28px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            gap: 16px;
            border: 1px solid rgba(0, 102, 255, 0.3);
            box-shadow: 0 8px 32px rgba(0, 102, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          }

          .logo {
            font-size: 40px;
            filter: drop-shadow(0 4px 12px rgba(255, 122, 69, 0.6));
            animation: float 3s ease-in-out infinite;
          }

          @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-8px); }
          }

          .hero h1 {
            font-size: 28px;
            font-weight: 800;
            margin-bottom: 4px;
            color: #ffffff;
            letter-spacing: -0.5px;
          }

          .hero p {
            font-size: 14px;
            color: #a0c4ff;
            font-weight: 500;
          }

          .card {
            background: white;
            border: 1px solid #e0e7ff;
            border-radius: 14px;
            padding: 24px;
            margin-bottom: 16px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04), 0 0 20px rgba(0, 102, 255, 0.08);
            transition: all 0.3s ease;
          }

          .card:hover {
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06), 0 0 30px rgba(0, 102, 255, 0.12);
            transform: translateY(-2px);
          }

          .form {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .route-display {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 12px;
            align-items: end;
          }

          .airport-pick {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .airport-display {
            position: relative;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .airport-code {
            font-size: 14px;
            font-weight: 900;
            color: #0066ff;
            min-width: 40px;
            text-align: center;
            font-family: 'Courier New', monospace;
            padding: 8px;
            background: linear-gradient(135deg, #f0f4ff 0%, #e8f0ff 100%);
            border-radius: 6px;
            border: 1px solid #d9e3ff;
          }

          .role {
            font-size: 11px;
            font-weight: 700;
            color: #999;
            text-transform: uppercase;
          }

          .picker, .date-input input {
            width: 100%;
            padding: 12px 14px;
            border: 1.5px solid #e0e7ff;
            border-radius: 10px;
            font-size: 16px;
            background: #f8f9ff;
            transition: all 0.2s;
            font-family: inherit;
          }

          .picker:focus, .date-input input:focus {
            outline: none;
            border-color: #0066ff;
            background: white;
            box-shadow: 0 0 0 3px rgba(0, 102, 255, 0.1), 0 2px 8px rgba(0, 102, 255, 0.15);
          }

          .swap-btn {
            padding: 10px 12px;
            border: 1.5px solid #e0e7ff;
            background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%);
            border-radius: 10px;
            cursor: pointer;
            font-size: 20px;
            height: 48px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .swap-btn:hover {
            background: linear-gradient(135deg, #f0f4ff 0%, #e8f0ff 100%);
            border-color: #b3c9ff;
            transform: rotate(180deg);
            box-shadow: 0 2px 8px rgba(0, 102, 255, 0.1);
          }

          /* 來回 / 單程 toggle — segmented control 風格 */
          .trip-type-row {
            display: flex;
            gap: 0;
            background: #f0f4ff;
            border-radius: 10px;
            padding: 4px;
            margin-bottom: 4px;
          }
          .trip-type-btn {
            flex: 1;
            padding: 10px 12px;
            background: transparent;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            color: #666;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .trip-type-btn.active {
            background: white;
            color: #0066ff;
            font-weight: 600;
            box-shadow: 0 2px 6px rgba(0, 102, 255, 0.15);
          }
          .trip-type-btn:disabled {
            cursor: not-allowed;
            opacity: 0.5;
          }

          .date-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .date-input {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .btn-primary {
            padding: 14px;
            background: linear-gradient(135deg, #0066ff 0%, #0052cc 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0, 102, 255, 0.3), 0 0 20px rgba(0, 102, 255, 0.15);
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            position: relative;
            overflow: hidden;
          }

          .btn-primary::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s;
          }

          .btn-primary:hover:not(:disabled)::before {
            left: 100%;
          }

          .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 102, 255, 0.4), 0 0 30px rgba(0, 102, 255, 0.2);
          }

          .btn-primary:active:not(:disabled) {
            transform: translateY(0);
          }

          .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            box-shadow: none;
          }

          .btn-secondary {
            padding: 12px;
            background: #f8f9ff;
            border: 1.5px solid #d0d9ff;
            border-radius: 10px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            color: #333;
            transition: all 0.2s;
          }

          .btn-secondary:hover {
            background: #f0f4ff;
            border-color: #b3c9ff;
            box-shadow: 0 2px 8px rgba(0, 102, 255, 0.1);
          }

          .btn-line-login {
            padding: 14px;
            background: #06c755;
            color: white;
            border: none;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            cursor: pointer;
            font-weight: 600;
          }

          .btn-line-login span:first-child {
            background: white;
            color: #06c755;
            width: 22px;
            height: 22px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 900;
          }

          .alert {
            padding: 14px 16px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 500;
            border: 1px solid;
            animation: slideInDown 0.3s ease-out;
          }

          @keyframes slideInDown {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .alert-error {
            background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
            color: #991b1b;
            border-color: #fecaca;
            box-shadow: 0 2px 8px rgba(239, 68, 68, 0.1);
          }

          /* === 新版搜尋結果樣式 === */
          .result-summary {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 14px 16px;
            background: linear-gradient(135deg, #f0f4ff 0%, #e8f0ff 100%);
            border-radius: 12px;
            margin-bottom: 14px;
          }
          .summary-line {
            display: flex;
            align-items: baseline;
            gap: 6px;
            font-size: 13px;
            color: #475569;
          }
          .summary-num {
            font-size: 17px;
            font-weight: 700;
            color: #0066ff;
            font-variant-numeric: tabular-nums;
          }
          .summary-sep {
            color: #cbd5e1;
            margin: 0 4px;
          }
          .summary-cheapest {
            font-size: 13px;
            color: #475569;
          }
          .summary-cheapest .accent {
            font-size: 19px;
            font-weight: 800;
            color: #ff7a45;
            margin-left: 6px;
            font-variant-numeric: tabular-nums;
          }

          /* 廉航 vs 傳統 對比卡 */
          .category-cards {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 14px;
          }
          .cat-card {
            padding: 12px 14px;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .cat-header {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
          }
          .cat-tag {
            font-size: 10px;
            font-weight: 700;
            padding: 3px 7px;
            border-radius: 4px;
            letter-spacing: 0.5px;
          }
          .lcc-tag { color: #0284c7; background: #e0f2fe; }
          .trad-tag { color: #b45309; background: #fef3c7; }
          .cat-airline {
            font-size: 12px;
            color: #475569;
            font-weight: 500;
          }
          .cat-est {
            font-size: 10px;
            color: #ef4444;
            font-weight: 600;
          }
          .cat-price {
            font-size: 19px;
            font-weight: 800;
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.3px;
          }
          .cat-price.lcc { color: #0284c7; }
          .cat-price.trad { color: #b45309; }
          @media (max-width: 480px) {
            .category-cards { grid-template-columns: 1fr; }
          }

          /* 航班 list */
          .flight-list {
            margin-bottom: 14px;
            padding: 12px;
            background: #fafafa;
            border-radius: 10px;
          }
          .fl-title {
            font-size: 13px;
            font-weight: 600;
            color: #475569;
            margin-bottom: 8px;
          }
          .fl-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            background: white;
            border-radius: 8px;
            margin-bottom: 6px;
            border: 1px solid transparent;
            transition: all 0.15s ease;
          }
          .fl-row.cheapest {
            border-color: #ff7a45;
            background: linear-gradient(135deg, #fff7ed 0%, #ffffff 50%);
          }
          .fl-left {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
            flex: 1;
          }
          .fl-airline {
            font-size: 13px;
            font-weight: 600;
            color: #1f2937;
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
          }
          .fl-fn {
            font-size: 11px;
            color: #94a3b8;
            font-weight: 500;
            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
          }
          .fl-badge {
            font-size: 10px;
            font-weight: 700;
            color: white;
            background: #ff7a45;
            padding: 2px 6px;
            border-radius: 3px;
          }
          .fl-time {
            font-size: 12px;
            color: #64748b;
            display: flex;
            align-items: center;
            gap: 4px;
            font-variant-numeric: tabular-nums;
          }
          .fl-t {
            font-weight: 600;
            color: #334155;
          }
          .fl-arrow {
            color: #cbd5e1;
            margin: 0 2px;
          }
          .fl-meta {
            color: #94a3b8;
            margin-left: 6px;
          }
          .fl-price {
            font-size: 15px;
            font-weight: 700;
            color: #1f2937;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
          }
          .fl-row.cheapest .fl-price {
            color: #ff7a45;
          }
          .fl-toggle {
            width: 100%;
            background: transparent;
            border: none;
            padding: 8px;
            font-size: 12px;
            color: #0066ff;
            cursor: pointer;
            font-weight: 500;
          }
          .fl-toggle:hover {
            background: #f1f5f9;
            border-radius: 6px;
          }

          .empty-hint {
            font-size: 12px;
            color: #94a3b8;
            margin-top: 4px;
          }

          .cache-hint {
            font-size: 11px;
            color: #94a3b8;
            text-align: center;
            margin: 8px 0;
          }

          /* === 舊樣式（其他地方還在用，保留）=== */
          .summary-cards {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 16px;
          }

          .stat {
            background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%);
            padding: 20px;
            border-radius: 12px;
            border: 1px solid #e0e7ff;
            text-align: center;
            transition: all 0.3s ease;
            box-shadow: 0 2px 8px rgba(0, 102, 255, 0.06);
          }

          .stat:hover {
            transform: translateY(-4px);
            box-shadow: 0 8px 20px rgba(0, 102, 255, 0.15);
            border-color: #b3c9ff;
          }

          .stat-label {
            font-size: 11px;
            color: #6b7280;
            margin-bottom: 8px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .stat-value {
            font-size: 22px;
            font-weight: 800;
            color: #1f2937;
            font-variant-numeric: tabular-nums;
          }

          .stat-value.accent {
            background: linear-gradient(135deg, #ff7a45 0%, #ff6b35 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: none;
          }

          .empty-state {
            text-align: center;
            padding: 32px 0;
          }

          .empty-state p {
            color: #666;
            margin-bottom: 16px;
          }

          .sub-input-row {
            display: flex;
            align-items: center;
            gap: 10px;
            background: #f9f9f9;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 8px 12px;
            margin-bottom: 12px;
          }

          .sub-prefix {
            color: #999;
            font-weight: 600;
          }

          .sub-input-row input {
            flex: 1;
            border: none;
            background: transparent;
            font-size: 18px;
            font-weight: 700;
            outline: none;
          }

          .sub-label-input {
            width: 100%;
            padding: 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            margin-bottom: 12px;
          }

          .toggle-group {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
          }

          .tg {
            padding: 10px;
            border: 1px solid #d1d5db;
            background: #f9f9f9;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s;
          }

          .tg.active {
            background: #0066ff;
            color: white;
            border-color: #0066ff;
          }

          .success-state {
            text-align: center;
            padding: 40px 20px;
            background: linear-gradient(135deg, #f0fdf4 0%, #f0f4ff 100%);
            border: 1px solid rgba(34, 197, 94, 0.2);
            border-radius: 12px;
            animation: fadeInScale 0.4s ease-out;
          }

          @keyframes fadeInScale {
            from {
              opacity: 0;
              transform: scale(0.95);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }

          .success-state .big {
            font-size: 64px;
            margin-bottom: 16px;
            animation: bounce 0.6s ease-out;
          }

          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
          }

          .success-state p {
            color: #1f2937;
            margin-bottom: 24px;
            line-height: 1.6;
            font-weight: 500;
          }

          .tg {
            padding: 12px 16px;
            border: 1.5px solid #e0e7ff;
            background: #f8f9ff;
            border-radius: 10px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            color: #666;
            transition: all 0.2s;
          }

          .tg:hover {
            background: #f0f4ff;
            border-color: #b3c9ff;
          }

          .tg.active {
            background: linear-gradient(135deg, #0066ff 0%, #0052cc 100%);
            color: white;
            border-color: #0052cc;
            box-shadow: 0 4px 12px rgba(0, 102, 255, 0.3);
          }

          @media (max-width: 640px) {
            .wrap {
              padding: 12px;
              padding-bottom: 60px;
            }

            .hero {
              padding: 20px;
              gap: 12px;
            }

            .hero h1 {
              font-size: 24px;
            }

            .card {
              padding: 16px;
              margin-bottom: 12px;
            }

            .btn-primary {
              padding: 12px;
              font-size: 15px;
            }

            .stat-value {
              font-size: 18px;
            }
          }
        `}</style>
      </div>
    </>
  );
}

