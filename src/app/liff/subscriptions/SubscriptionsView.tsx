'use client';

import { useEffect, useState } from 'react';
import { formatAirport } from '@/config/airports';
import type { Subscription } from '@/types';

interface Props {
  liffId: string;
}

export default function SubscriptionsView({ liffId }: Props) {
  const [ready, setReady] = useState(false);
  const [canLogin, setCanLogin] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [items, setItems] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!liffId) {
      setError('需要設定 LIFF ID 才能使用此頁');
      setReady(true);
      return;
    }
    (async () => {
      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId });
        setCanLogin(true);
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();
          setSourceId(profile.userId);
          setProfileName(profile.displayName);
        } else if (liff.isInClient()) {
          liff.login();
          return;
        }
        setReady(true);
      } catch (err) {
        setError(`LIFF 初始化失敗：${err instanceof Error ? err.message : String(err)}`);
        setReady(true);
      }
    })();
  }, [liffId]);

  const handleLogin = async () => {
    if (!liffId) return;
    try {
      const liff = (await import('@line/liff')).default;
      liff.login({
        redirectUri: typeof window !== 'undefined' ? window.location.href : undefined
      });
    } catch (err) {
      setError('登入失敗，請稍後再試');
    }
  };

  useEffect(() => {
    if (!sourceId) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/subscriptions?sourceId=${encodeURIComponent(sourceId)}`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        setItems(data.subscriptions ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [sourceId]);

  const handleDelete = async (id: number) => {
    if (!sourceId) return;
    if (!confirm('確定要取消這個訂閱嗎？')) return;

    try {
      const res = await fetch(
        `/api/subscriptions?id=${id}&sourceId=${encodeURIComponent(sourceId)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setItems(items.filter(i => i.id !== id));
    } catch (err) {
      alert(`刪除失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!ready) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>載入中…</p>
        <style jsx>{`
          .loading {
            min-height: 100vh; display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 16px;
            color: #7e88a8;
          }
          .spinner {
            width: 40px; height: 40px;
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top-color: #ff7a45; border-radius: 50%;
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
          <span className="logo">🔔</span>
          <div>
            <h1>我的訂閱</h1>
            <p>{profileName ? `${profileName} 的降價提醒` : '降價提醒'}</p>
          </div>
        </div>
      </header>

      {error && <div className="alert">⚠️ {error}</div>}

      {!sourceId && canLogin && !error && (
        <div className="login-card">
          <div className="big">🔐</div>
          <h2>需要登入才能看訂閱</h2>
          <p>用 LINE 登入後就能看到你訂閱的航線、降價提醒設定。</p>
          <button onClick={handleLogin} className="btn-line">
            <span className="line-icon">L</span>
            <span>用 LINE 登入</span>
          </button>
        </div>
      )}

      {sourceId && loading ? (
        <div className="empty">
          <div className="spinner" />
          <p>載入訂閱中…</p>
        </div>
      ) : sourceId && items.length === 0 ? (
        <div className="empty">
          <div className="big">💤</div>
          <h2>還沒有訂閱</h2>
          <p>到搜尋頁面查詢航班，按「訂閱降價提醒」就會出現在這裡。</p>
          <a className="btn" href={liffId ? `https://liff.line.me/${liffId}` : '/liff/search'}>
            🔍 開始查詢
          </a>
        </div>
      ) : sourceId ? (
        <div className="list">
          {items.map(sub => (
            <div key={sub.id} className="card">
              <div className="route">
                <span className="city">{formatAirport(sub.origin)}</span>
                <span className="arrow">→</span>
                <span className="city">{formatAirport(sub.destination)}</span>
              </div>
              {sub.outbound_date && sub.return_date && (
                <div className="dates">
                  📅 {sub.outbound_date} ~ {sub.return_date}
                </div>
              )}
              <div className="price-row">
                <span className="threshold">
                  跌破 <strong>NT$ {Number(sub.max_price).toLocaleString()}</strong> 通知我
                </span>
                <button className="del" onClick={() => sub.id && handleDelete(sub.id)}>
                  ✕ 取消
                </button>
              </div>
              {sub.last_notified_at && (
                <div className="last">
                  上次通知：{new Date(sub.last_notified_at).toLocaleString('zh-TW')}
                </div>
              )}
            </div>
          ))}
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
        .hero {
          background: linear-gradient(135deg, rgba(255, 122, 69, 0.18), rgba(96, 165, 250, 0.06));
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 16px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .logo {
          font-size: 32px;
          filter: drop-shadow(0 4px 12px rgba(255, 122, 69, 0.4));
        }
        .hero h1 {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 2px;
        }
        .hero p {
          font-size: 13px;
          color: #cdd5f0;
        }
        .alert {
          margin-bottom: 16px;
          padding: 14px 16px;
          border-radius: 12px;
          background: rgba(248, 113, 113, 0.12);
          color: #f87171;
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .card {
          background: #1a2238;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 14px;
          padding: 16px;
        }
        .route {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 17px;
          font-weight: 700;
          margin-bottom: 6px;
        }
        .arrow { color: #ff7a45; }
        .dates {
          font-size: 13px;
          color: #cdd5f0;
          margin-bottom: 10px;
        }
        .price-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 8px;
        }
        .threshold {
          font-size: 14px;
          color: #cdd5f0;
        }
        .threshold strong { color: #ff7a45; }
        .del {
          background: transparent;
          border: 1px solid rgba(248, 113, 113, 0.4);
          color: #f87171;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
        }
        .del:hover {
          background: rgba(248, 113, 113, 0.12);
        }
        .last {
          font-size: 11px;
          color: #7e88a8;
          margin-top: 8px;
        }
        .empty {
          background: #1a2238;
          border: 1px dashed #2a3454;
          border-radius: 16px;
          padding: 60px 24px;
          text-align: center;
        }
        .empty .big {
          font-size: 56px;
          margin-bottom: 12px;
        }
        .empty h2 {
          font-size: 18px;
          margin-bottom: 6px;
        }
        .empty p {
          color: #7e88a8;
          font-size: 14px;
          margin-bottom: 20px;
        }
        .empty .spinner {
          width: 32px; height: 32px;
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-top-color: #ff7a45; border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin: 0 auto 12px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .btn {
          display: inline-block;
          padding: 12px 24px;
          background: linear-gradient(135deg, #ff7a45, #ff6020);
          color: white;
          font-weight: 600;
          border-radius: 10px;
          text-decoration: none;
        }

        .login-card {
          background: #1a2238;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 16px;
          padding: 40px 24px;
          text-align: center;
        }
        .login-card .big { font-size: 56px; margin-bottom: 12px; }
        .login-card h2 { font-size: 18px; margin-bottom: 6px; }
        .login-card p {
          color: #7e88a8;
          font-size: 14px;
          margin-bottom: 20px;
        }
        .btn-line {
          padding: 14px 24px;
          border: none;
          border-radius: 10px;
          background: #06c755;
          color: white;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .btn-line:hover { background: #05b14d; }
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
      `}</style>
    </div>
  );
}
