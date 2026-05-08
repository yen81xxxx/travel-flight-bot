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
      // 沒設定 LIFF ID（瀏覽器本機測試），直接 ready
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
            // 沒授權 profile scope 也沒關係
            console.warn('getProfile failed:', e);
          }
        } else if (liff.isInClient()) {
          // 在 LINE App 裡但沒 token，嘗試 login（通常不需要）
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

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          destination,
          outboundDate,
          returnDate,
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

  const closeLiff = async () => {
    if (!liffId) return;
    try {
      const liff = (await import('@line/liff')).default;
      if (liff.isInClient()) {
        liff.closeWindow();
      }
    } catch {
      // ignore
    }
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
    return <div className="loading">載入中…</div>;
  }

  return (
    <div className="liff-container">
      <header>
        <h1>✈️ 機票查詢</h1>
        <p className="sub">
          台灣 → 日本{profileName && `　・　${profileName} 你好`}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="form">
        <div className="row">
          <label>
            <span>出發地</span>
            <select
              value={origin}
              onChange={e => setOrigin(e.target.value)}
              disabled={loading}
            >
              {origins.map(a => (
                <option key={a.iata} value={a.iata}>
                  {a.city} ({a.iata})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>目的地</span>
            <select
              value={destination}
              onChange={e => setDestination(e.target.value)}
              disabled={loading}
            >
              {Object.entries(destByRegion).map(([region, list]) => (
                <optgroup key={region} label={region}>
                  {list.map(a => (
                    <option key={a.iata} value={a.iata}>
                      {a.city} {a.name} ({a.iata})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="row">
          <label>
            <span>去程</span>
            <input
              type="date"
              value={outboundDate}
              onChange={e => setOutboundDate(e.target.value)}
              required
              disabled={loading}
            />
          </label>
          <label>
            <span>回程</span>
            <input
              type="date"
              value={returnDate}
              onChange={e => setReturnDate(e.target.value)}
              required
              disabled={loading}
            />
          </label>
        </div>

        <button type="submit" disabled={loading} className="primary">
          {loading ? '查詢中（5-15 秒）…' : '🔍 查詢航班'}
        </button>
      </form>

      {error && <div className="error">❌ {error}</div>}

      {result && result.ok && result.analysis && (
        <div className="result">
          <div className="summary">
            <div className="card">
              <h3>最便宜往返</h3>
              <div className="value accent">
                {fmt(result.analysis.cheapestRoundTripPrice)}
              </div>
            </div>
            <div className="card">
              <h3>主推航空</h3>
              <div className="value">{result.analysis.cheapestAirline ?? '—'}</div>
            </div>
          </div>

          {result.fromCache && <div className="hint">📦 來自快取（6 小時內查過）</div>}

          {result.outbound && result.outbound.length > 0 && (
            <>
              <h2>去程</h2>
              {[...result.outbound]
                .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
                .map((r, i) => (
                  <div key={i} className="flight-row">
                    <div className="airline">{r.airline ?? '—'}</div>
                    <div className="price">{fmt(r.price)}</div>
                    <div className="meta">
                      {fmtDuration(r.duration_minutes)}
                      {r.stops === 0 ? '直飛' : `${r.stops} 次轉機`}
                    </div>
                  </div>
                ))}
            </>
          )}

          {result.return && result.return.length > 0 && (
            <>
              <h2>回程</h2>
              {[...result.return]
                .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
                .map((r, i) => (
                  <div key={i} className="flight-row">
                    <div className="airline">{r.airline ?? '—'}</div>
                    <div className="price">{fmt(r.price)}</div>
                    <div className="meta">
                      {fmtDuration(r.duration_minutes)}
                      {r.stops === 0 ? '直飛' : `${r.stops} 次轉機`}
                    </div>
                  </div>
                ))}
            </>
          )}

          {sourceId && (
            <div className="hint">✅ 結果已同步推到 LINE 聊天室</div>
          )}

          {insideLine && (
            <button onClick={closeLiff} className="secondary">
              關閉視窗
            </button>
          )}
        </div>
      )}

      <style jsx>{`
        .liff-container {
          max-width: 640px;
          margin: 0 auto;
          padding: 16px;
          font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC',
            'Microsoft JhengHei', sans-serif;
        }
        header {
          margin-bottom: 24px;
        }
        h1 {
          font-size: 24px;
          margin-bottom: 4px;
        }
        .sub {
          color: var(--muted, #8a9aab);
          font-size: 13px;
        }
        .form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .row {
          display: flex;
          gap: 12px;
        }
        .row label {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .row span {
          font-size: 12px;
          color: var(--muted, #8a9aab);
        }
        .row select,
        .row input {
          padding: 12px;
          border-radius: 8px;
          border: 1px solid var(--border, #2a3542);
          background: var(--panel, #1a2129);
          color: var(--text, #e8eef5);
          font-size: 16px;
          font-family: inherit;
        }
        .primary {
          padding: 16px;
          border: none;
          border-radius: 10px;
          background: var(--accent, #ff7a45);
          color: white;
          font-size: 17px;
          font-weight: 600;
          cursor: pointer;
        }
        .primary:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .secondary {
          margin-top: 16px;
          padding: 12px;
          border: 1px solid var(--border, #2a3542);
          border-radius: 10px;
          background: transparent;
          color: var(--text, #e8eef5);
          font-size: 15px;
          cursor: pointer;
          width: 100%;
        }
        .error {
          margin-top: 16px;
          padding: 12px;
          background: rgba(248, 113, 113, 0.1);
          color: var(--bad, #f87171);
          border-radius: 8px;
        }
        .hint {
          margin-top: 12px;
          padding: 10px;
          background: rgba(74, 222, 128, 0.1);
          color: var(--good, #4ade80);
          border-radius: 8px;
          font-size: 13px;
        }
        .loading {
          padding: 80px 20px;
          text-align: center;
          color: var(--muted, #8a9aab);
        }
        .result {
          margin-top: 24px;
        }
        .summary {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .card {
          background: var(--panel, #1a2129);
          border: 1px solid var(--border, #2a3542);
          border-radius: 10px;
          padding: 14px;
        }
        .card h3 {
          font-size: 11px;
          color: var(--muted, #8a9aab);
          text-transform: uppercase;
          margin-bottom: 6px;
          font-weight: 500;
        }
        .card .value {
          font-size: 18px;
          font-weight: 700;
        }
        .card .accent {
          color: var(--accent, #ff7a45);
        }
        .result h2 {
          font-size: 16px;
          margin: 20px 0 8px;
        }
        .flight-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 4px 12px;
          padding: 12px;
          border-bottom: 1px solid var(--border, #2a3542);
        }
        .flight-row .airline {
          font-weight: 600;
        }
        .flight-row .price {
          font-weight: 700;
          color: var(--accent, #ff7a45);
          text-align: right;
        }
        .flight-row .meta {
          grid-column: 1 / -1;
          font-size: 12px;
          color: var(--muted, #8a9aab);
        }
      `}</style>
    </div>
  );
}
