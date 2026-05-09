'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatAirport } from '@/config/airports';
import type { Subscription } from '@/types';
import Sparkline from './Sparkline';

interface Props {
  liffId: string;
}

// 為了區分來源
type ItemWithSource = Subscription & { _source: 'personal' | 'group' };

interface GroupBucket {
  groupId: string;
  name: string | null;
  items: ItemWithSource[];
}

export default function SubscriptionsView({ liffId }: Props) {
  const [ready, setReady] = useState(false);
  const [canLogin, setCanLogin] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [groupCtxId, setGroupCtxId] = useState<string | null>(null);
  const [items, setItems] = useState<ItemWithSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});

  // 從 URL 讀 ctx（群組 ID）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get('ctx');
    if (ctx && (ctx.startsWith('C') || ctx.startsWith('R'))) {
      setGroupCtxId(ctx);
    }
  }, []);

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
        // 同時抓「個人訂閱」與（如果有 ctx）「該群組訂閱」
        const promises: Promise<{ subs: Subscription[]; source: 'personal' | 'group' }>[] = [
          fetch(`/api/subscriptions?sourceId=${encodeURIComponent(sourceId)}`)
            .then(r => r.json())
            .then(d => ({ subs: d.ok ? (d.subscriptions ?? []) : [], source: 'personal' as const }))
        ];
        if (groupCtxId) {
          promises.push(
            fetch(`/api/subscriptions?sourceId=${encodeURIComponent(groupCtxId)}`)
              .then(r => r.json())
              .then(d => ({ subs: d.ok ? (d.subscriptions ?? []) : [], source: 'group' as const }))
          );
        }
        const results = await Promise.all(promises);
        const merged: ItemWithSource[] = [];
        for (const { subs, source } of results) {
          for (const s of subs) {
            merged.push({ ...s, _source: source });
          }
        }
        setItems(merged);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [sourceId, groupCtxId]);

  // 把訂閱分成「個人」與「群組（按 source_id 再分群）」
  const { personalItems, groupBuckets } = useMemo(() => {
    const personal = items.filter(i => i._source === 'personal');
    const groupMap = new Map<string, ItemWithSource[]>();
    for (const it of items) {
      if (it._source === 'group') {
        const arr = groupMap.get(it.source_id) ?? [];
        arr.push(it);
        groupMap.set(it.source_id, arr);
      }
    }
    const buckets: GroupBucket[] = Array.from(groupMap.entries()).map(([gid, arr]) => ({
      groupId: gid,
      name: groupNames[gid] ?? null,
      items: arr
    }));
    return { personalItems: personal, groupBuckets: buckets };
  }, [items, groupNames]);

  // 對所有出現的群組 ID，背景拉群組名（拉一次就 cache）
  useEffect(() => {
    const idsToFetch = groupBuckets
      .map(b => b.groupId)
      .filter(gid => groupNames[gid] === undefined);
    if (idsToFetch.length === 0) return;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(idsToFetch.map(async gid => {
        try {
          const res = await fetch(`/api/group-info?groupId=${encodeURIComponent(gid)}`);
          const d = await res.json();
          if (d.ok && d.groupName) updates[gid] = d.groupName;
          else updates[gid] = ''; // 標記失敗、避免重複嘗試
        } catch {
          updates[gid] = '';
        }
      }));
      setGroupNames(prev => ({ ...prev, ...updates }));
    })();
  }, [groupBuckets, groupNames]);

  const handleDelete = async (sub: ItemWithSource) => {
    if (!sub.id) return;
    const label = sub._source === 'group' ? '群組訂閱' : '個人訂閱';
    if (!confirm(`確定取消這筆${label}嗎？`)) return;

    try {
      const res = await fetch(
        `/api/subscriptions?id=${sub.id}&sourceId=${encodeURIComponent(sub.source_id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setItems(items.filter(i => i.id !== sub.id));
    } catch (err) {
      alert(`刪除失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = (sub: Subscription) => {
    setEditingId(sub.id ?? null);
    setEditPrice(String(sub.max_price));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditPrice('');
  };
  const saveEdit = async (sub: ItemWithSource) => {
    const newPrice = parseFloat(editPrice);
    if (isNaN(newPrice) || newPrice <= 0) {
      alert('請輸入有效的金額');
      return;
    }
    setSavingEdit(true);
    try {
      // 用每筆訂閱自身的 source_id 更新（群組訂閱 sourceId = groupId）
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: sub.source_id,
          origin: sub.origin,
          destination: sub.destination,
          maxPrice: newPrice,
          outboundDate: sub.outbound_date ?? undefined,
          returnDate: sub.return_date ?? undefined
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '更新失敗');
      setItems(items.map(i => i.id === sub.id ? { ...i, max_price: newPrice } : i));
      cancelEdit();
    } catch (err) {
      alert(`更新失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleTest = async (sub: ItemWithSource) => {
    if (!sub.id) return;
    try {
      const res = await fetch('/api/subscriptions/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId: sub.id, sourceId: sub.source_id })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const where = sub._source === 'group' ? '群組' : '你的';
      alert(`✅ 測試通知已發送，請看${where}聊天室`);
    } catch (err) {
      alert(`測試失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTogglePause = async (sub: ItemWithSource) => {
    if (!sub.id) return;
    const newPaused = !sub.paused;
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, sourceId: sub.source_id, paused: newPaused })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setItems(items.map(i => i.id === sub.id ? { ...i, paused: newPaused } : i));
    } catch (err) {
      alert(`操作失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleEditLabel = async (sub: ItemWithSource) => {
    if (!sub.id) return;
    const newLabel = prompt('輸入備註（留空則清除）', sub.label ?? '');
    if (newLabel === null) return; // 使用者按取消
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sub.id,
          sourceId: sub.source_id,
          label: newLabel.trim() || null
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setItems(items.map(i => i.id === sub.id ? { ...i, label: newLabel.trim() || null } : i));
    } catch (err) {
      alert(`操作失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const renderCard = (sub: ItemWithSource) => (
    <div key={`${sub._source}-${sub.id}`} className={`card ${sub._source} ${sub.paused ? 'paused' : ''}`}>
      <div className="card-header">
        <div className="route">
          <span className="city">{formatAirport(sub.origin)}</span>
          <span className="arrow">→</span>
          <span className="city">{formatAirport(sub.destination)}</span>
        </div>
        {sub.paused && <span className="chip-paused">⏸️ 暫停中</span>}
      </div>
      {sub.label && (
        <div className="label-line">📝 {sub.label}</div>
      )}
      {sub.outbound_date && sub.return_date && (
        <div className="dates">
          📅 {sub.outbound_date} ~ {sub.return_date}
        </div>
      )}
      {editingId === sub.id ? (
        <div className="edit-row">
          <div className="edit-input-wrap">
            <span className="edit-prefix">NT$</span>
            <input
              type="number"
              inputMode="numeric"
              value={editPrice}
              onChange={e => setEditPrice(e.target.value)}
              disabled={savingEdit}
              autoFocus
            />
          </div>
          <div className="edit-actions">
            <button className="btn-save" onClick={() => saveEdit(sub)} disabled={savingEdit}>
              {savingEdit ? '儲存中…' : '✓ 儲存'}
            </button>
            <button className="btn-cancel-edit" onClick={cancelEdit} disabled={savingEdit}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="price-row">
            <span className="threshold">
              跌破 <strong>NT$ {Number(sub.max_price).toLocaleString()}</strong> 通知我
            </span>
          </div>
          <div className="actions-row">
            <button className="btn-edit" onClick={() => startEdit(sub)}>金額</button>
            <button className="btn-label" onClick={() => handleEditLabel(sub)}>備註</button>
            <button
              className={sub.paused ? 'btn-resume' : 'btn-pause'}
              onClick={() => handleTogglePause(sub)}
            >
              {sub.paused ? '繼續' : '暫停'}
            </button>
            <button className="btn-test" onClick={() => handleTest(sub)}>試發</button>
            <button className="del" onClick={() => handleDelete(sub)}>取消</button>
          </div>
        </>
      )}
      {sub.last_notified_at && (
        <div className="last">
          上次通知：{new Date(sub.last_notified_at).toLocaleString('zh-TW')}
        </div>
      )}
      <Sparkline
        origin={sub.origin}
        destination={sub.destination}
        outboundDate={sub.outbound_date}
        returnDate={sub.return_date}
        threshold={Number(sub.max_price)}
      />
    </div>
  );

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
          <div className="brand-text">
            <h1>{groupCtxId ? '訂閱清單' : '我的訂閱'}</h1>
            <p>
              {groupCtxId
                ? `個人訂閱 + 此群組訂閱（共 ${items.length} 筆）`
                : (profileName ? `${profileName} 的降價提醒` : '降價提醒')}
            </p>
          </div>
          <a className="nav-btn" href={liffId ? `https://liff.line.me/${liffId}${groupCtxId ? `?ctx=${encodeURIComponent(groupCtxId)}` : ''}` : '/liff/search'}>
            🔍 查航班
          </a>
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
      ) : sourceId ? (
        <>
          {/* 個人訂閱區塊 */}
          <div className="section-head">
            <span className="section-icon">👤</span>
            <h2 className="section-title">我的訂閱</h2>
            <span className="section-count">{personalItems.length}</span>
          </div>
          {personalItems.length === 0 ? (
            <div className="section-empty">
              還沒有個人訂閱{' '}
              <a href={liffId ? `https://liff.line.me/${liffId}` : '/liff/search'}>去查航班 →</a>
            </div>
          ) : (
            <div className="list">
              {personalItems.map(sub => renderCard(sub))}
            </div>
          )}

          {/* 群組訂閱區塊 */}
          <div className="section-head" style={{ marginTop: 24 }}>
            <span className="section-icon">👥</span>
            <h2 className="section-title">群組訂閱</h2>
            <span className="section-count">
              {groupBuckets.reduce((sum, b) => sum + b.items.length, 0)}
            </span>
          </div>
          {groupBuckets.length === 0 ? (
            <div className="section-empty">
              {groupCtxId
                ? '這個群組還沒有訂閱'
                : '沒有資料 — 在 LINE 群組裡傳「我的訂閱」可看該群組的訂閱'}
            </div>
          ) : (
            groupBuckets.map(bucket => (
              <div key={bucket.groupId} className="group-bucket">
                <div className="group-header">
                  <span className="group-marker">📌</span>
                  <span className="group-name">
                    {bucket.name && bucket.name.length > 0
                      ? bucket.name
                      : `群組 ${bucket.groupId.slice(0, 8)}…`}
                  </span>
                  <span className="group-count">{bucket.items.length}</span>
                </div>
                <div className="list">
                  {bucket.items.map(sub => renderCard(sub))}
                </div>
              </div>
            ))
          )}
        </>
      ) : null}

      <style jsx global>{`
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
        .brand-text {
          flex: 1;
        }
        .nav-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #f0f4ff;
          padding: 8px 14px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
          transition: background 0.15s;
          white-space: nowrap;
        }
        .nav-btn:hover {
          background: rgba(255, 122, 69, 0.15);
          border-color: rgba(255, 122, 69, 0.4);
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
        .card.group {
          border-left: 4px solid #60a5fa;
        }
        .card.personal {
          border-left: 4px solid #ff7a45;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
          flex-wrap: wrap;
        }
        .source-chip {
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .source-chip.personal {
          background: rgba(255, 122, 69, 0.15);
          color: #ff7a45;
        }
        .source-chip.group {
          background: rgba(96, 165, 250, 0.15);
          color: #60a5fa;
        }
        .chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .chip-paused {
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          background: rgba(251, 191, 36, 0.18);
          color: #fbbf24;
          white-space: nowrap;
        }
        .card.paused {
          opacity: 0.6;
        }
        .label-line {
          font-size: 13px;
          color: #cdd5f0;
          background: rgba(255, 255, 255, 0.04);
          padding: 6px 10px;
          border-radius: 8px;
          margin-top: 8px;
          margin-bottom: 4px;
        }
        .btn-label {
          flex: 1;
          background: rgba(96, 165, 250, 0.08);
          border: 1px solid rgba(96, 165, 250, 0.4);
          color: #60a5fa;
          padding: 8px 6px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .btn-label:hover { background: rgba(96, 165, 250, 0.16); }
        .btn-pause {
          flex: 1;
          background: rgba(251, 191, 36, 0.10);
          border: 1px solid rgba(251, 191, 36, 0.4);
          color: #fbbf24;
          padding: 8px 6px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .btn-pause:hover { background: rgba(251, 191, 36, 0.18); }
        .btn-resume {
          flex: 1;
          background: rgba(74, 222, 128, 0.10);
          border: 1px solid rgba(74, 222, 128, 0.4);
          color: #4ade80;
          padding: 8px 6px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .btn-resume:hover { background: rgba(74, 222, 128, 0.18); }
        .route {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 16px;
          font-weight: 700;
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
          padding: 8px 6px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .del:hover {
          background: rgba(248, 113, 113, 0.12);
        }
        .actions-row {
          display: flex;
          gap: 6px;
          margin-top: 12px;
        }
        .actions-row > button {
          flex: 1;
          min-width: 0;
        }
        .section-head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 8px 0 12px;
          padding: 0 4px;
        }
        .section-icon { font-size: 18px; }
        .section-title {
          font-size: 15px;
          font-weight: 700;
          color: #f0f4ff;
          flex: 1;
          margin: 0;
        }
        .section-count {
          background: rgba(255, 122, 69, 0.15);
          color: #ff7a45;
          font-size: 12px;
          font-weight: 700;
          padding: 2px 10px;
          border-radius: 999px;
        }
        .section-empty {
          padding: 18px;
          font-size: 13px;
          color: #7e88a8;
          background: rgba(255, 255, 255, 0.02);
          border: 1px dashed #2a3454;
          border-radius: 12px;
          text-align: center;
        }
        .section-empty :global(a) {
          color: #ff7a45;
          text-decoration: none;
          font-weight: 600;
        }
        .group-bucket {
          margin-bottom: 16px;
        }
        .group-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(96, 165, 250, 0.10);
          border-left: 3px solid #60a5fa;
          border-radius: 6px;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .group-marker { font-size: 14px; }
        .group-name {
          flex: 1;
          font-weight: 600;
          color: #cdd5f0;
        }
        .group-count {
          color: #60a5fa;
          font-weight: 700;
          font-size: 12px;
        }
        .btn-edit {
          flex: 1;
          background: rgba(255, 122, 69, 0.10);
          border: 1px solid rgba(255, 122, 69, 0.4);
          color: #ff7a45;
          padding: 8px 6px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .btn-edit:hover {
          background: rgba(255, 122, 69, 0.18);
        }
        .btn-test {
          flex: 1;
          background: rgba(96, 165, 250, 0.08);
          border: 1px solid rgba(96, 165, 250, 0.4);
          color: #60a5fa;
          padding: 8px 6px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .btn-test:hover {
          background: rgba(96, 165, 250, 0.16);
        }
        .edit-row {
          margin-top: 10px;
        }
        .edit-input-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #0a0e1a;
          border: 1px solid #ff7a45;
          border-radius: 10px;
          padding: 4px 12px;
        }
        .edit-prefix {
          color: #7e88a8;
          font-size: 13px;
          font-weight: 600;
        }
        .edit-input-wrap input {
          flex: 1;
          padding: 10px 0;
          border: none;
          background: transparent;
          color: #f0f4ff;
          font-size: 16px;
          font-weight: 700;
          font-family: inherit;
          outline: none;
          -moz-appearance: textfield;
        }
        .edit-input-wrap input::-webkit-outer-spin-button,
        .edit-input-wrap input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .edit-actions {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }
        .btn-save {
          flex: 1;
          padding: 10px;
          border: none;
          border-radius: 8px;
          background: linear-gradient(135deg, #ff7a45, #ff6020);
          color: white;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .btn-save:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btn-cancel-edit {
          padding: 10px 16px;
          border: 1px solid #2a3454;
          background: transparent;
          color: #cdd5f0;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          font-family: inherit;
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
