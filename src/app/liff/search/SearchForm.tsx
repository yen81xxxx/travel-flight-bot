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

  // 預設日期：30 天後出發、停 4 晚
  useEffect(() => {
    const now = new Date();
    const out = new Date(now.getTime() + 30 * 86400_000);
    const ret = new Date(out.getTime() + 4 * 86400_000);
    setOutboundDate(out.toISOString().slice(0, 10));
    setReturnDate(ret.toISOString().slice(0, 10));
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
        setInsideLine(liff.isInClient());
        if (liff.isLoggedIn()) {
          try {
            const profile = await liff.getProfile();
            setSourceId(profile.userId);
            setProfileName(profile.displayName);
          } catch (e) {
            console.warn('getProfile failed:', e);
          }
        } else if (liff.isInClient()) {
          liff.login();
          return;
        }
        setLiffReady(true);
      } catch (err) {
        console.error('LIFF init failed:', err);
        setError(`LIFF 初始化失敗：${err instanceof Error ? err.message : String(err)}`);
        setLiffReady(true);
      }
    })();
  }, [liffId]);

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
          sourceId: sourceId ?? undefined
        })
      });
      const data: SearchResponse = await res.json();
      if (!data.ok) throw new Error(data.error || '搜尋失敗');
      setResult(data);
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

    setSubscribeStatus('saving');
    try {
      const maxPrice = result.analysis.cheapestRoundTripPrice;
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId,
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

      {result && result.ok && result.analysis && (
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
            <button
              onClick={handleSubscribe}
              disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved'}
              className="btn-subscribe"
            >
              {subscribeStatus === 'saved' ? (
                <>✅ 已訂閱降價提醒</>
              ) : subscribeStatus === 'saving' ? (
                <>⏳ 訂閱中…</>
              ) : (
                <>🔔 訂閱降價提醒（低於 {fmt(result.analysis.cheapestRoundTripPrice)} 通知我）</>
              )}
            </button>
          )}

          {sourceId && (
            <div className="alert alert-success">
              ✅ 結果已同步推到 LINE 聊天室
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
          margin-top: 12px;
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          border: 1px solid rgba(255, 122, 69, 0.4);
          background: rgba(255, 122, 69, 0.08);
          color: #ff7a45;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .btn-subscribe:hover:not(:disabled) {
          background: rgba(255, 122, 69, 0.15);
        }
        .btn-subscribe:disabled {
          opacity: 0.6;
          cursor: not-allowed;
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
