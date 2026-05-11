'use client';

import { useEffect, useState } from 'react';

interface Props { liffId: string; }

export default function SettingsView({ liffId }: Props) {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [groupCtxId, setGroupCtxId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);

  // 設定的目標 source（個人 = userId、群組 = groupCtxId）
  const targetSourceId = groupCtxId ?? userId;
  const isGroupContext = !!groupCtxId;

  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [dailySummary, setDailySummary] = useState(true);
  const [priceAlerts, setPriceAlerts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 從 URL 讀 ctx
  // ⚠️ LIFF OAuth redirect 會吃掉 ?ctx，靠 sessionStorage 跨 redirect 保留
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let ctx = new URLSearchParams(window.location.search).get('ctx');
    if (ctx && (ctx.startsWith('C') || ctx.startsWith('R'))) {
      sessionStorage.setItem('liff_ctx', ctx);
    } else {
      const saved = sessionStorage.getItem('liff_ctx');
      if (saved && (saved.startsWith('C') || saved.startsWith('R'))) {
        ctx = saved;
      }
    }
    if (ctx) setGroupCtxId(ctx);
  }, []);

  useEffect(() => {
    if (!liffId) {
      setError('需要 LIFF ID');
      setReady(true);
      return;
    }
    (async () => {
      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId });
        if (liff.isLoggedIn()) {
          const p = await liff.getProfile();
          setUserId(p.userId);
          setProfileName(p.displayName);
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

  // 拿群組名（如果是群組情境）
  useEffect(() => {
    if (!groupCtxId) return;
    (async () => {
      try {
        const r = await fetch(`/api/group-info?groupId=${encodeURIComponent(groupCtxId)}`);
        const d = await r.json();
        if (d.ok && d.groupName) setGroupName(d.groupName);
      } catch {}
    })();
  }, [groupCtxId]);

  // 載入既有設定
  useEffect(() => {
    if (!targetSourceId) return;
    (async () => {
      try {
        const r = await fetch(`/api/notification-settings?sourceId=${encodeURIComponent(targetSourceId)}`);
        const d = await r.json();
        if (d.ok && d.settings) {
          if (d.settings.quiet_start && d.settings.quiet_end) {
            setQuietStart(d.settings.quiet_start.slice(0, 5));
            setQuietEnd(d.settings.quiet_end.slice(0, 5));
            setQuietEnabled(true);
          }
          if (typeof d.settings.daily_summary === 'boolean') setDailySummary(d.settings.daily_summary);
          if (typeof d.settings.price_alerts === 'boolean') setPriceAlerts(d.settings.price_alerts);
        }
      } catch {}
    })();
  }, [targetSourceId]);

  const handleLogin = async () => {
    if (!liffId) return;
    const liff = (await import('@line/liff')).default;
    liff.login({
      redirectUri: typeof window !== 'undefined' ? window.location.href : undefined
    });
  };

  const save = async () => {
    if (!targetSourceId) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      const r = await fetch('/api/notification-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: targetSourceId,
          quietStart: quietEnabled ? quietStart : null,
          quietEnd: quietEnabled ? quietEnd : null,
          timezone: 'Asia/Taipei',
          dailySummary,
          priceAlerts
        })
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setSavedMsg('✅ 設定已儲存');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return <main className="loading">載入中…<style jsx>{`.loading{padding:80px;text-align:center;color:#7e88a8;}`}</style></main>;
  }

  if (!userId) {
    return (
      <main className="wrap">
        <div className="card">
          <h2>需要登入</h2>
          <button onClick={handleLogin} className="btn-line">用 LINE 登入</button>
        </div>
        <style jsx>{`
          .wrap { max-width: 480px; margin: 0 auto; padding: 32px 16px; }
          .card { background: #1a2238; border: 1px solid #2a3454; border-radius: 16px; padding: 24px; text-align: center; }
          h2 { font-size: 18px; margin-bottom: 16px; }
          .btn-line { padding: 12px 24px; background: #06c755; color: white; border: none; border-radius: 10px; font-weight: 700; cursor: pointer; }
        `}</style>
      </main>
    );
  }

  const headerSubtitle = isGroupContext
    ? `📌 ${groupName ?? '群組'} 的通知設定`
    : `${profileName ?? ''} 的通知設定`;

  return (
    <main className="wrap">
      <header className="hero">
        <h1>⚙️ 通知設定</h1>
        <p>{headerSubtitle}</p>
        {isGroupContext && (
          <p className="hint-group">這個設定只影響此群組的通知，跟你個人的設定獨立</p>
        )}
      </header>

      <section className="card">
        <div className="row">
          <div>
            <h3>📮 每日航班摘要</h3>
            <p className="hint">每天 09:00 推播當日 TPE→HND 最低價</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={dailySummary} onChange={e => setDailySummary(e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        <div className="divider" />

        <div className="row">
          <div>
            <h3>🔔 降價提醒</h3>
            <p className="hint">訂閱的航線跌破門檻時推播</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={priceAlerts} onChange={e => setPriceAlerts(e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        <div className="divider" />

        <div className="row">
          <div>
            <h3>🌙 靜音時段</h3>
            <p className="hint">這段時間內不發送任何通知</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={quietEnabled} onChange={e => setQuietEnabled(e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        {quietEnabled && (
          <div className="time-row">
            <label>
              <span>開始</span>
              <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} />
            </label>
            <span className="dash">~</span>
            <label>
              <span>結束</span>
              <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} />
            </label>
          </div>
        )}

        <p className="tz">時區：Asia/Taipei（GMT+8）</p>

        <button onClick={save} disabled={saving} className="btn-save">
          {saving ? '儲存中…' : '💾 儲存'}
        </button>

        {savedMsg && <div className="alert success">{savedMsg}</div>}
        {error && <div className="alert error">{error}</div>}
      </section>

      <p className="footnote">
        💡 即便關閉所有通知，cron 仍會繼續更新訂閱的歷史價格資料（你打開「我的訂閱」時還是看得到走勢圖）。
        {isGroupContext && ' 想設你個人的通知，從 1:1 跟 bot 對話視窗傳「設定」進入。'}
      </p>

      <style jsx>{`
        .wrap {
          max-width: 480px;
          margin: 0 auto;
          padding: 24px 16px;
          font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', sans-serif;
        }
        .hero {
          background: linear-gradient(135deg, rgba(255,122,69,.18), rgba(96,165,250,.06));
          border: 1px solid rgba(255,255,255,.06);
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 16px;
        }
        h1 { font-size: 22px; font-weight: 800; }
        .hero p { font-size: 13px; color: #cdd5f0; margin-top: 4px; }
        .hint-group {
          margin-top: 8px;
          padding: 6px 10px;
          background: rgba(96,165,250,.1);
          border-left: 3px solid #60a5fa;
          border-radius: 6px;
          font-size: 12px;
          color: #cdd5f0;
        }
        .card {
          background: #1a2238;
          border: 1px solid #2a3454;
          border-radius: 16px;
          padding: 20px;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }
        h3 { font-size: 16px; font-weight: 700; }
        .hint { font-size: 12px; color: #7e88a8; margin-top: 4px; }
        .divider { height: 1px; background: rgba(255,255,255,.06); margin: 16px 0; }
        .switch { position: relative; display: inline-block; width: 50px; height: 28px; flex-shrink: 0; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider {
          position: absolute; cursor: pointer; inset: 0;
          background: #2a3454; border-radius: 28px;
          transition: 0.2s;
        }
        .slider::before {
          content: ''; position: absolute;
          height: 22px; width: 22px;
          left: 3px; bottom: 3px;
          background: white; border-radius: 50%;
          transition: 0.2s;
        }
        input:checked + .slider { background: #ff7a45; }
        input:checked + .slider::before { transform: translateX(22px); }
        .time-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 16px;
        }
        .time-row label {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .time-row label span {
          font-size: 11px;
          color: #7e88a8;
          font-weight: 700;
          letter-spacing: .06em;
          text-transform: uppercase;
        }
        .time-row input {
          padding: 12px;
          border-radius: 10px;
          border: 1px solid #2a3454;
          background: #0a0e1a;
          color: #f0f4ff;
          font-size: 16px;
          font-family: inherit;
        }
        .dash { padding-top: 16px; color: #7e88a8; font-weight: 700; }
        .tz { font-size: 12px; color: #7e88a8; margin-top: 12px; text-align: center; }
        .btn-save {
          margin-top: 16px;
          width: 100%;
          padding: 14px;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #ff7a45, #ff6020);
          color: white;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
        }
        .btn-save:disabled { opacity: .6; cursor: wait; }
        .alert {
          margin-top: 12px;
          padding: 10px;
          border-radius: 8px;
          font-size: 13px;
        }
        .alert.success { background: rgba(74,222,128,.1); color: #4ade80; }
        .alert.error { background: rgba(248,113,113,.1); color: #f87171; }
        .footnote {
          margin-top: 20px;
          padding: 12px;
          background: rgba(255,255,255,.03);
          border-radius: 10px;
          font-size: 12px;
          color: #7e88a8;
          line-height: 1.6;
        }
      `}</style>
    </main>
  );
}
