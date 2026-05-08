'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Airport } from '@/config/airports';

interface Props {
  liffId: string;
  origins: Airport[];
  destinations: Airport[];
}

interface FlightRow {
  airline: string | null;
  price: number | null;
  duration_minutes: number | null;
  stops: number;
  flight_type: 'best' | 'other';
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
  };
  fromCache?: boolean;
  error?: string;
}

export default function SearchForm({ liffId, origins, destinations }: Props) {
  const [liffReady, setLiffReady] = useState(false);
  const [insideLine, setInsideLine] = useState(false);
  const [canLogin, setCanLogin] = useState(false);  // LIFF 已載入且可登入（電腦版場景）
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);

  const [origin, setOrigin] = useState('TPE');
  const [destination, setDestination] = useState('HND');
  const [outboundDate, setOutboundDate] = useState('');
  const [returnDate, setReturnDate] = useState('');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [customMaxPrice, setCustomMaxPrice] = useState<string>('');
  const [groupCtxId, setGroupCtxId] = useState<string | null>(null);
  const [subscribeAs, setSubscribeAs] = useState<'self' | 'group'>('self');

  // 預設日期：30 天後出發、停 4 晚
  useEffect(() => {
    const now = new Date();
    const out = new Date(now.getTime() + 30 * 86400_000);
    const ret = new Date(out.getTime() + 4 * 86400_000);
    setOutboundDate(out.toISOString().slice(0, 10));
    setReturnDate(ret.toISOString().slice(0, 10));
  }, []);

  // 從 URL 讀 ctx (群組 ID)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get('ctx');
    if (ctx && (ctx.startsWith('C') || ctx.startsWith('R'))) {
      setGroupCtxId(ctx);
    }
  }, []);

  // LIFF 初始化
  useEffect(() => {
    if (!liffId) {
      setLiffReady(true);
      return;
    }
    (async () => {
      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId });
        const isInClient = liff.isInClient();
        setInsideLine(isInClient);
        setCanLogin(true);  // LIFF 已可用，無論是否在 LINE 內

        if (liff.isLoggedIn()) {
          try {
            const profile = await liff.getProfile();
            setSourceId(profile.userId);
            setProfileName(profile.displayName);
          } catch (e) {
            console.warn('getProfile failed:', e);
          }
        } else if (isInClient) {
          // 在 LINE App 內但沒 token，直接 login（不需要使用者點按鈕）
          liff.login();
          return;
        }
        // 在外部瀏覽器且沒登入 → 不自動 login，等使用者按按鈕
        setLiffReady(true);
      } catch (err) {
        console.error('LIFF init failed:', err);
        setError(`LIFF 初始化失敗：${err instanceof Error ? err.message : String(err)}`);
        setLiffReady(true);
      }
    })();
  }, [liffId]);

  const handleLineLogin = async () => {
    if (!liffId) return;
    try {
      const liff = (await import('@line/liff')).default;
      // 帶 redirectUri 讓登入後回到原本頁面（含搜尋條件保留）
      liff.login({
        redirectUri: typeof window !== 'undefined' ? window.location.href : undefined
      });
    } catch (err) {
      console.error('login failed:', err);
      setError('登入失敗，請稍後再試');
    }
  };

  const destByRegion = useMemo(() => {
    const groups: Record<string, Airport[]> = {};
    for (const d of destinations) {
      const r = d.region ?? '其他';
      (groups[r] = groups[r] ?? []).push(d);
    }
    return groups;
  }, [destinations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 前端驗證日期
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out = new Date(outboundDate);
    const ret = new Date(returnDate);

    if (isNaN(out.getTime()) || isNaN(ret.getTime())) {
      setError('日期格式錯誤');
      return;
    }
    if (out < today) {
      setError('去程日期不能在過去（請確認年份是否為今年或之後）');
      return;
    }
    if (ret <= out) {
      setError('回程日期必須晚於去程日期');
      return;
    }
    const tripDays = Math.round((ret.getTime() - out.getTime()) / 86400_000);
    if (tripDays > 60) {
      const ok = confirm(`旅程長度 ${tripDays} 天，超過 60 天 SerpApi 可能查無資料。確定要查嗎？`);
      if (!ok) return;
    }
    const aheadDays = Math.round((out.getTime() - today.getTime()) / 86400_000);
    if (aheadDays > 330) {
      setError('出發日期離今天超過 11 個月，太遠通常還沒開放訂位');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setSubscribeStatus('idle');

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin, destination, outboundDate, returnDate,
          // 群組情境下不要 push 每次查詢結果到群組（會吵），只要訂閱才 push 通知
          sourceId: groupCtxId ? undefined : (sourceId ?? undefined)
        })
      });
      const data: SearchResponse = await res.json();
      if (!data.ok) throw new Error(data.error || '搜尋失敗');
      setResult(data);
      // 預設訂閱門檻 = 當下最便宜價格
      if (data.analysis?.cheapestRoundTripPrice) {
        setCustomMaxPrice(String(data.analysis.cheapestRoundTripPrice));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    if (!sourceId) {
      setError('需要在 LINE 內開啟才能訂閱');
      return;
    }
    if (!result?.analysis?.cheapestRoundTripPrice) return;

    const userInputPrice = parseFloat(customMaxPrice);
    if (isNaN(userInputPrice) || userInputPrice <= 0) {
      setError('請輸入有效的金額');
      return;
    }

    setSubscribeStatus('saving');
    try {
      const maxPrice = userInputPrice;
      // 訂給群組或個人
      const targetSourceId = subscribeAs === 'group' && groupCtxId ? groupCtxId : sourceId;
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: targetSourceId,
          origin,
          destination,
          maxPrice,
          outboundDate,
          returnDate
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '訂閱失敗');
      setSubscribeStatus('saved');
    } catch (err) {
      console.error(err);
      setSubscribeStatus('error');
      setError(err instanceof Error ? err.message : '訂閱失敗');
    }
  };

  const closeLiff = async () => {
    if (!liffId) return;
    try {
      const liff = (await import('@line/liff')).default;
      if (liff.isInClient()) liff.closeWindow();
    } catch {}
  };

  const fmt = (n: number | null | undefined) =>
    n != null ? `NT$ ${n.toLocaleString()}` : '—';
  const fmtDuration = (m: number | null | undefined) => {
    if (m == null) return '—';
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h}h${min > 0 ? min + 'm' : ''}`;
  };

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
    <div className="wrap">
      <header className="hero">
        <div className="brand">
          <span className="logo">✈️</span>
          <div>
            <h1>機票查詢</h1>
            <p>{profileName ? `Hi, ${profileName} 👋` : '台灣 → 日本'}</p>
          </div>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="card form">
        <div className="route-display">
          <div className="airport-pick">
            <span className="role">FROM</span>
            <select
              value={origin}
              onChange={e => setOrigin(e.target.value)}
              disabled={loading}
              className="picker"
            >
              {origins.map(a => (
                <option key={a.iata} value={a.iata}>
                  {a.city} {a.iata}
                </option>
              ))}
            </select>
          </div>

          <div className="arrow-icon">→</div>

          <div className="airport-pick">
            <span className="role">TO</span>
            <select
              value={destination}
              onChange={e => setDestination(e.target.value)}
              disabled={loading}
              className="picker"
            >
              {Object.entries(destByRegion).map(([region, list]) => (
                <optgroup key={region} label={region}>
                  {list.map(a => (
                    <option key={a.iata} value={a.iata}>
                      {a.city} {a.iata}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="date-row">
          <label className="date-input">
            <span className="role">📅 去程</span>
            <input
              type="date"
              value={outboundDate}
              onChange={e => setOutboundDate(e.target.value)}
              required
              disabled={loading}
              min={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <label className="date-input">
            <span className="role">📅 回程</span>
            <input
              type="date"
              value={returnDate}
              onChange={e => setReturnDate(e.target.value)}
              required
              disabled={loading}
              min={outboundDate || new Date().toISOString().slice(0, 10)}
            />
          </label>
        </div>

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <><span className="mini-spinner" /> 查詢中（5-15 秒）…</>
          ) : (
            <>🔍 查詢航班</>
          )}
        </button>

        <p className="hint">
          篩選：星宇 / 長榮 / 虎航 / 捷星 / 酷航
        </p>
      </form>

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      {result && result.ok && result.analysis && result.analysis.outboundCount === 0 && (
        <div className="empty-result">
          <div className="big">🔍</div>
          <h3>找不到符合條件的航班</h3>
          <p>可能的原因：</p>
          <ul>
            <li>📅 日期太久之前或太久之後（SerpApi 通常只有未來 11 個月內的票）</li>
            <li>✈️ 這條航線沒有星宇 / 長榮 / 虎航 / 捷星 / 酷航直飛或合理轉機</li>
            <li>🗓️ 旅程長度太長（&gt; 60 天 Google Flights 可能不顯示）</li>
            <li>🏝️ 冷門目的地（例如石垣島）+ 冷門日期 = 無班機</li>
          </ul>
          <p>建議改個日期再試。</p>
        </div>
      )}

      {result && result.ok && result.analysis && result.analysis.outboundCount > 0 && (
        <div className="results">
          {result.fromCache && (
            <div className="alert alert-info">📦 來自快取（6 小時內查過）</div>
          )}

          <div className="summary-cards">
            <div className="stat">
              <div className="stat-label">最便宜往返</div>
              <div className="stat-value accent">
                {fmt(result.analysis.cheapestRoundTripPrice)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">主推航空</div>
              <div className="stat-value">
                {result.analysis.cheapestAirline ?? '—'}
              </div>
            </div>
          </div>

          {sourceId && result.analysis.cheapestRoundTripPrice && (
            <div className="sub-card">
              <div className="sub-title">🔔 訂閱降價提醒</div>
              <div className="sub-desc">
                當這條航線最便宜往返跌破下面金額時，自動 LINE 通知
                {groupCtxId ? '（你選擇的對象）' : '你'}
              </div>

              {groupCtxId && (
                <div className="target-toggle">
                  <button
                    type="button"
                    className={subscribeAs === 'self' ? 'tg active' : 'tg'}
                    onClick={() => setSubscribeAs('self')}
                  >
                    👤 通知我自己
                  </button>
                  <button
                    type="button"
                    className={subscribeAs === 'group' ? 'tg active' : 'tg'}
                    onClick={() => setSubscribeAs('group')}
                  >
                    👥 通知整個群組
                  </button>
                </div>
              )}

              <div className="sub-input-row">
                <span className="sub-prefix">NT$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={customMaxPrice}
                  onChange={e => setCustomMaxPrice(e.target.value)}
                  placeholder="輸入金額"
                  disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved'}
                />
              </div>

              <div className="preset-row">
                {[
                  { label: '當下價', mult: 1 },
                  { label: '-10%', mult: 0.9 },
                  { label: '-20%', mult: 0.8 },
                  { label: '-30%', mult: 0.7 }
                ].map(p => {
                  const cheapest = result.analysis!.cheapestRoundTripPrice!;
                  const value = Math.round(cheapest * p.mult);
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setCustomMaxPrice(String(value))}
                      className="preset-btn"
                      disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved'}
                    >
                      <span className="preset-label">{p.label}</span>
                      <span className="preset-value">{value.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={handleSubscribe}
                disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved' || !customMaxPrice}
                className="btn-subscribe"
              >
                {subscribeStatus === 'saved' ? (
                  <>✅ 已訂閱（低於 NT$ {Number(customMaxPrice).toLocaleString()} 會通知）</>
                ) : subscribeStatus === 'saving' ? (
                  <>⏳ 訂閱中…</>
                ) : (
                  <>確認訂閱（低於 NT$ {customMaxPrice ? Number(customMaxPrice).toLocaleString() : '—'}）</>
                )}
              </button>
            </div>
          )}

          {!sourceId && canLogin && result.analysis.cheapestRoundTripPrice && (
            <button onClick={handleLineLogin} className="btn-line-login">
              <span className="line-icon">L</span>
              <span>用 LINE 登入以訂閱降價提醒</span>
            </button>
          )}

          {sourceId && !groupCtxId && (
            <div className="alert alert-info">
              💬 查詢結果已同步推到你和 Bot 的 1:1 聊天室
            </div>
          )}

          {subscribeStatus === 'saved' && (
            <div className="success-banner">
              <div className="big">🎉</div>
              <div className="text">
                <strong>訂閱完成！</strong>
                <p>
                  跌破 NT$ {Number(customMaxPrice).toLocaleString()}{' '}
                  時會自動 LINE 通知{subscribeAs === 'group' ? '整個群組' : '你'}。
                </p>
                <p>
                  確認訊息已發到{subscribeAs === 'group' ? '群組' : '你的'}聊天室，去看一下。
                </p>
              </div>
            </div>
          )}

          {result.outbound && result.outbound.length > 0 && (
            <>
              <h2 className="section-h">🛫 去程</h2>
              <div className="flight-list">
                {[...result.outbound]
                  .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
                  .map((r, i, arr) => (
                    <FlightCard key={i} row={r} cheapest={i === 0} />
                  ))}
              </div>
            </>
          )}

          {result.return && result.return.length > 0 && (
            <>
              <h2 className="section-h">🛬 回程</h2>
              <div className="flight-list">
                {[...result.return]
                  .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
                  .map((r, i) => (
                    <FlightCard key={i} row={r} cheapest={i === 0} />
                  ))}
              </div>
            </>
          )}

          {insideLine && (
            <button onClick={closeLiff} className="btn-secondary">
              ✕ 關閉視窗
            </button>
          )}
        </div>
      )}

      <style jsx>{`
        .wrap {
          max-width: 640px;
          margin: 0 auto;
          padding: 16px;
          padding-bottom: 80px;
          font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC',
            'Microsoft JhengHei', sans-serif;
        }

        /* Hero */
        .hero {
          background: linear-gradient(135deg, rgba(255, 122, 69, 0.18), rgba(96, 165, 250, 0.06));
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 16px;
          position: relative;
          overflow: hidden;
        }
        .hero::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -10%;
          width: 250px;
          height: 250px;
          background: radial-gradient(circle, rgba(255, 122, 69, 0.2), transparent 70%);
          pointer-events: none;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 14px;
          position: relative;
          z-index: 1;
        }
        .logo {
          font-size: 36px;
          filter: drop-shadow(0 4px 12px rgba(255, 122, 69, 0.4));
        }
        .hero h1 {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 2px;
        }
        .hero p {
          font-size: 13px;
          color: #cdd5f0;
        }

        /* Card / Form */
        .card {
          background: #1a2238;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        .form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* Route picker */
        .route-display {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: end;
          gap: 8px;
          padding: 8px 0;
        }
        .airport-pick {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .role {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #7e88a8;
          text-transform: uppercase;
        }
        .arrow-icon {
          font-size: 22px;
          color: #ff7a45;
          padding-bottom: 12px;
          font-weight: 700;
        }

        .picker, .date-input input {
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          border: 1px solid #2a3454;
          background: #0a0e1a;
          color: #f0f4ff;
          font-size: 16px;
          font-family: inherit;
        }
        .picker:focus, .date-input input:focus {
          outline: 2px solid #ff7a45;
          outline-offset: -1px;
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

        /* Buttons */
        .btn-primary {
          padding: 16px;
          border: none;
          border-radius: 12px;
          background: linear-gradient(135deg, #ff7a45, #ff6020);
          color: white;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.02em;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: transform 0.1s, box-shadow 0.2s;
          box-shadow: 0 4px 12px rgba(255, 122, 69, 0.3);
        }
        .btn-primary:active { transform: scale(0.98); }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: wait;
          background: #2a3454;
          box-shadow: none;
        }

        .btn-secondary {
          margin-top: 20px;
          padding: 14px;
          border: 1px solid #2a3454;
          border-radius: 12px;
          background: transparent;
          color: #cdd5f0;
          font-size: 15px;
          width: 100%;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-secondary:hover { background: rgba(255, 255, 255, 0.04); }

        .btn-subscribe {
          margin-top: 14px;
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          border: none;
          background: linear-gradient(135deg, #ff7a45, #ff6020);
          color: white;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
          box-shadow: 0 4px 12px rgba(255, 122, 69, 0.3);
        }
        .btn-subscribe:active { transform: scale(0.98); }
        .btn-subscribe:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          background: #2a3454;
          box-shadow: none;
          color: #cdd5f0;
        }

        .sub-card {
          margin-top: 16px;
          background: linear-gradient(135deg, rgba(255, 122, 69, 0.10), rgba(255, 122, 69, 0.04));
          border: 1px solid rgba(255, 122, 69, 0.25);
          border-radius: 14px;
          padding: 18px;
        }
        .sub-title {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 4px;
        }
        .sub-desc {
          font-size: 12px;
          color: #cdd5f0;
          margin-bottom: 14px;
          line-height: 1.5;
        }
        .target-toggle {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 12px;
        }
        .tg {
          padding: 10px;
          border-radius: 10px;
          border: 1px solid #2a3454;
          background: rgba(255, 255, 255, 0.04);
          color: #cdd5f0;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .tg.active {
          border-color: #ff7a45;
          background: rgba(255, 122, 69, 0.15);
          color: #ff7a45;
        }
        .sub-input-row {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #0a0e1a;
          border: 1px solid #2a3454;
          border-radius: 10px;
          padding: 6px 14px;
        }
        .sub-input-row:focus-within {
          border-color: #ff7a45;
        }
        .sub-prefix {
          color: #7e88a8;
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
        }
        .sub-input-row input {
          flex: 1;
          padding: 12px 0;
          border: none;
          background: transparent;
          color: #f0f4ff;
          font-size: 18px;
          font-weight: 700;
          font-family: inherit;
          outline: none;
          -moz-appearance: textfield;
        }
        .sub-input-row input::-webkit-outer-spin-button,
        .sub-input-row input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        .preset-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          margin-top: 10px;
        }
        .preset-btn {
          padding: 8px 4px;
          border: 1px solid #2a3454;
          background: rgba(255, 255, 255, 0.04);
          color: #cdd5f0;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          transition: all 0.15s;
          font-family: inherit;
        }
        .preset-btn:hover:not(:disabled) {
          border-color: #ff7a45;
          background: rgba(255, 122, 69, 0.08);
        }
        .preset-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .preset-label {
          font-size: 11px;
          color: #7e88a8;
          font-weight: 600;
        }
        .preset-value {
          font-size: 13px;
          font-weight: 700;
          color: #f0f4ff;
        }

        .btn-line-login {
          margin-top: 12px;
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          border: none;
          background: #06c755;
          color: white;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: background 0.15s, transform 0.1s;
        }
        .btn-line-login:hover { background: #05b14d; }
        .btn-line-login:active { transform: scale(0.98); }
        .line-icon {
          background: white;
          color: #06c755;
          width: 22px;
          height: 22px;
          border-radius: 5px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-family: Arial, sans-serif;
        }

        .hint {
          font-size: 12px;
          color: #7e88a8;
          text-align: center;
          margin-top: 4px;
        }

        /* Spinner */
        .mini-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Alerts */
        .alert {
          margin-top: 16px;
          padding: 14px 16px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 500;
        }
        .alert-error {
          background: rgba(248, 113, 113, 0.12);
          color: #f87171;
          border: 1px solid rgba(248, 113, 113, 0.25);
        }
        .alert-info {
          background: rgba(251, 191, 36, 0.1);
          color: #fbbf24;
        }
        .alert-success {
          background: rgba(74, 222, 128, 0.1);
          color: #4ade80;
        }

        .empty-result {
          margin-top: 16px;
          padding: 24px;
          border-radius: 14px;
          background: #1a2238;
          border: 1px dashed #2a3454;
          text-align: center;
        }
        .empty-result .big {
          font-size: 48px;
          margin-bottom: 12px;
        }
        .empty-result h3 {
          font-size: 17px;
          font-weight: 700;
          margin-bottom: 12px;
        }
        .empty-result p {
          font-size: 14px;
          color: #cdd5f0;
          margin: 8px 0;
        }
        .empty-result ul {
          text-align: left;
          margin: 12px 0;
          padding-left: 20px;
          color: #cdd5f0;
          font-size: 13px;
        }
        .empty-result ul li {
          margin: 6px 0;
        }

        .success-banner {
          margin-top: 16px;
          padding: 20px;
          border-radius: 14px;
          background: linear-gradient(135deg, rgba(74, 222, 128, 0.18), rgba(74, 222, 128, 0.06));
          border: 1px solid rgba(74, 222, 128, 0.4);
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }
        .success-banner .big {
          font-size: 36px;
          line-height: 1;
        }
        .success-banner .text {
          flex: 1;
        }
        .success-banner strong {
          color: #4ade80;
          font-size: 16px;
          display: block;
          margin-bottom: 6px;
        }
        .success-banner p {
          font-size: 13px;
          color: #cdd5f0;
          margin: 4px 0;
          line-height: 1.5;
        }

        /* Results */
        .results { margin-top: 24px; }
        .summary-cards {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 16px;
        }
        .stat {
          background: #1a2238;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 14px;
          padding: 16px;
        }
        .stat-label {
          font-size: 11px;
          color: #7e88a8;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .stat-value {
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }
        .stat-value.accent { color: #ff7a45; }

        .section-h {
          font-size: 17px;
          font-weight: 700;
          margin: 24px 0 10px;
        }

        .flight-list {
          background: #1a2238;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 14px;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}

function FlightCard({ row, cheapest }: { row: FlightRow; cheapest: boolean }) {
  const fmt = (n: number | null | undefined) =>
    n != null ? `NT$ ${n.toLocaleString()}` : '—';
  const fmtDuration = (m: number | null | undefined) => {
    if (m == null) return '—';
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h}h${min > 0 ? min + 'm' : ''}`;
  };
  return (
    <div className="flight-card">
      <div className="airline-row">
        <span className="airline">{row.airline ?? '—'}</span>
        <div className="tags">
          {row.flight_type === 'best' && <span className="tag tag-rec">推薦</span>}
          {cheapest && <span className="tag tag-low">最低</span>}
        </div>
      </div>
      <div className="meta-row">
        <span className="duration">⏱ {fmtDuration(row.duration_minutes)}</span>
        <span className={`stops ${row.stops === 0 ? 'direct' : ''}`}>
          {row.stops === 0 ? '✦ 直飛' : `${row.stops} 次轉機`}
        </span>
      </div>
      <div className="price">{fmt(row.price)}</div>
      <style jsx>{`
        .flight-card {
          padding: 14px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 4px 12px;
          align-items: center;
        }
        .flight-card:last-child { border-bottom: none; }
        .airline-row {
          grid-column: 1;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .airline {
          font-size: 15px;
          font-weight: 600;
        }
        .tags { display: flex; gap: 4px; }
        .tag {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 999px;
          letter-spacing: 0.04em;
        }
        .tag-rec {
          background: rgba(255, 122, 69, 0.15);
          color: #ff7a45;
        }
        .tag-low {
          background: rgba(74, 222, 128, 0.15);
          color: #4ade80;
        }
        .meta-row {
          grid-column: 1;
          font-size: 12px;
          color: #7e88a8;
          display: flex;
          gap: 12px;
        }
        .stops.direct { color: #4ade80; font-weight: 500; }
        .price {
          grid-row: 1 / span 2;
          grid-column: 2;
          font-size: 18px;
          font-weight: 800;
          color: #ff7a45;
          white-space: nowrap;
          align-self: center;
        }
      `}</style>
    </div>
  );
}
