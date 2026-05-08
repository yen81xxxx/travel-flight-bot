'use client';

import { useEffect, useState } from 'react';

interface Stats {
  activeSubscriptions: number;
  totalSubscriptions: number;
  uniqueUsers: number;
  cachedQuotes: number;
  runsLast7d: number;
  runsFailedLast7d: number;
  notifsLast30d: number;
}
interface Quota {
  thisMonth: number;
  cachedHits: number;
  estimatedRemaining: number;
}
interface Route { route: string; count: number; }
interface ErrorRow {
  id: number;
  origin: string;
  destination: string;
  error_message: string;
  started_at: string;
}
interface AdminData {
  stats: Stats;
  quota: Quota;
  topRoutes: Route[];
  recentErrors: ErrorRow[];
}

export default function AdminView() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (pwd: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { 'Authorization': `Bearer ${pwd}` }
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '請求失敗');
      setData(data);
      setAuthed(true);
      sessionStorage.setItem('admin_pwd', pwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? sessionStorage.getItem('admin_pwd') : null;
    if (saved) {
      setPassword(saved);
      load(saved);
    }
  }, []);

  if (!authed) {
    return (
      <main className="login-main">
        <div className="login-box">
          <h1>🔐 Admin</h1>
          <input
            type="password"
            placeholder="管理密碼"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(password)}
          />
          <button onClick={() => load(password)} disabled={loading}>
            {loading ? '驗證中…' : '進入'}
          </button>
          {error && <div className="error">{error}</div>}
        </div>
        <style jsx>{`
          .login-main {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .login-box {
            background: #1a2238;
            border: 1px solid #2a3454;
            border-radius: 16px;
            padding: 32px;
            width: 100%;
            max-width: 380px;
          }
          h1 {
            font-size: 24px;
            margin-bottom: 20px;
          }
          input {
            width: 100%;
            padding: 12px;
            margin-bottom: 12px;
            border-radius: 8px;
            border: 1px solid #2a3454;
            background: #0a0e1a;
            color: #f0f4ff;
            font-size: 15px;
          }
          button {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 8px;
            background: #ff7a45;
            color: white;
            font-weight: 700;
            cursor: pointer;
          }
          button:disabled { opacity: 0.6; }
          .error {
            margin-top: 12px;
            padding: 10px;
            background: rgba(248, 113, 113, 0.12);
            color: #f87171;
            border-radius: 8px;
            font-size: 13px;
          }
        `}</style>
      </main>
    );
  }

  if (!data) return <main>Loading…</main>;

  const failureRate = data.stats.runsLast7d > 0
    ? ((data.stats.runsFailedLast7d / data.stats.runsLast7d) * 100).toFixed(1)
    : '0';

  return (
    <main>
      <header>
        <h1>📊 系統健康度</h1>
        <button onClick={() => load(password)} className="refresh">🔄 重新整理</button>
      </header>

      <div className="grid">
        <div className="stat">
          <div className="lbl">活躍訂閱</div>
          <div className="val">{data.stats.activeSubscriptions}</div>
          <div className="sub">/ 共 {data.stats.totalSubscriptions} 筆（含已取消）</div>
        </div>
        <div className="stat">
          <div className="lbl">使用者數</div>
          <div className="val">{data.stats.uniqueUsers}</div>
          <div className="sub">獨立 LINE source</div>
        </div>
        <div className="stat">
          <div className="lbl">7 天執行</div>
          <div className="val">{data.stats.runsLast7d}</div>
          <div className={`sub ${parseFloat(failureRate) > 10 ? 'bad' : ''}`}>
            失敗 {data.stats.runsFailedLast7d}（{failureRate}%）
          </div>
        </div>
        <div className="stat">
          <div className="lbl">30 天通知</div>
          <div className="val">{data.stats.notifsLast30d}</div>
          <div className="sub">推給訂閱者</div>
        </div>
      </div>

      <h2>📈 SerpApi 配額</h2>
      <div className="quota">
        <div className="quota-bar-wrap">
          <div className="quota-bar" style={{ width: `${Math.min(100, (data.quota.thisMonth / 250) * 100)}%` }} />
        </div>
        <div className="quota-info">
          <span>本月 <strong>{data.quota.thisMonth}</strong> / 250</span>
          <span>剩 <strong className="ok">{data.quota.estimatedRemaining}</strong></span>
          <span>快取命中 <strong>{data.quota.cachedHits}</strong></span>
        </div>
      </div>

      <h2>🔥 熱門路線</h2>
      {data.topRoutes.length === 0 ? (
        <div className="empty">還沒有訂閱資料</div>
      ) : (
        <table>
          <thead>
            <tr><th>路線</th><th>訂閱數</th></tr>
          </thead>
          <tbody>
            {data.topRoutes.map(r => (
              <tr key={r.route}>
                <td>{r.route}</td>
                <td>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>⚠️ 最近錯誤</h2>
      {data.recentErrors.length === 0 ? (
        <div className="empty good">無錯誤紀錄 ✓</div>
      ) : (
        <table>
          <thead>
            <tr><th>時間</th><th>路線</th><th>錯誤</th></tr>
          </thead>
          <tbody>
            {data.recentErrors.map(e => (
              <tr key={e.id}>
                <td className="t">{new Date(e.started_at).toLocaleString('zh-TW')}</td>
                <td>{e.origin}→{e.destination}</td>
                <td className="err">{e.error_message?.slice(0, 80) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <style jsx>{`
        main {
          max-width: 1100px;
          margin: 0 auto;
          padding: 32px 20px;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        h1 { font-size: 28px; font-weight: 800; }
        h2 {
          font-size: 18px;
          font-weight: 700;
          margin: 32px 0 12px;
        }
        .refresh {
          background: transparent;
          border: 1px solid #2a3454;
          color: #cdd5f0;
          padding: 8px 16px;
          border-radius: 8px;
          cursor: pointer;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
        }
        .stat {
          background: #1a2238;
          border: 1px solid #2a3454;
          border-radius: 12px;
          padding: 18px;
        }
        .lbl {
          font-size: 11px;
          color: #7e88a8;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .val {
          font-size: 28px;
          font-weight: 800;
          color: #ff7a45;
        }
        .sub {
          font-size: 12px;
          color: #7e88a8;
          margin-top: 4px;
        }
        .sub.bad { color: #f87171; }
        .quota {
          background: #1a2238;
          border: 1px solid #2a3454;
          border-radius: 12px;
          padding: 16px;
        }
        .quota-bar-wrap {
          height: 12px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 6px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        .quota-bar {
          height: 100%;
          background: linear-gradient(90deg, #4ade80, #ff7a45, #f87171);
          transition: width 0.3s;
        }
        .quota-info {
          display: flex;
          gap: 16px;
          font-size: 13px;
          color: #cdd5f0;
        }
        .quota-info .ok { color: #4ade80; }
        table {
          width: 100%;
          background: #1a2238;
          border: 1px solid #2a3454;
          border-radius: 12px;
          overflow: hidden;
          border-collapse: collapse;
        }
        th, td {
          padding: 10px 14px;
          text-align: left;
          border-bottom: 1px solid #2a3454;
          font-size: 13px;
        }
        th {
          font-weight: 600;
          color: #7e88a8;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.04em;
          background: rgba(255, 255, 255, 0.02);
        }
        .t { color: #7e88a8; white-space: nowrap; font-size: 12px; }
        .err { color: #f87171; font-family: monospace; font-size: 11px; }
        .empty {
          padding: 30px;
          text-align: center;
          color: #7e88a8;
          background: #1a2238;
          border: 1px dashed #2a3454;
          border-radius: 12px;
        }
        .empty.good { color: #4ade80; }
      `}</style>
    </main>
  );
}
