'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { useKnownGroupCtxs } from '@/hooks/useKnownGroupCtxs';
import { useLiff } from '@/hooks/useLiff';
import { Alert, Badge, Button, EmptyState, Spinner } from '@/components';
import type { Subscription } from '@/types';
import TabNav from '../TabNav';

interface Props {
  liffId: string;
}

type ItemWithSource = Subscription & { _source: 'personal' | 'group' };

export default function SubscriptionsViewV2({ liffId }: Props) {
  // LIFF 初始化
  const { liffReady, user } = useLiff(liffId);
  const sourceId = user?.userId ?? null;

  // 群組上下文（當下這個 LIFF session 是從哪個群組進來的；URL 帶 ctx 才會有）
  const [groupCtxId, setGroupCtxId] = useSessionStorage<string | null>('liff_ctx', null);
  // 使用者進過的所有群組（localStorage 持久化，跨 LIFF session 都記得）
  const { ctxs: knownGroupCtxs, add: addKnownGroupCtx } = useKnownGroupCtxs();

  // 訂閱數據
  const [items, setItems] = useState<ItemWithSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  // 改價 modal 狀態
  const [editingSub, setEditingSub] = useState<ItemWithSource | null>(null);
  const [editMainPrice, setEditMainPrice] = useState<string>('');
  const [editTradEnabled, setEditTradEnabled] = useState<boolean>(false);
  const [editTradPrice, setEditTradPrice] = useState<string>('');
  const [editSaving, setEditSaving] = useState<boolean>(false);

  // 初始化群組 ID（URL → sessionStorage + localStorage）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get('ctx');
    if (ctx && (ctx.startsWith('C') || ctx.startsWith('R'))) {
      setGroupCtxId(ctx);
      addKnownGroupCtx(ctx);
    }
  }, [setGroupCtxId, addKnownGroupCtx]);

  // 加載訂閱列表 — 個人 + 所有已知群組（合併顯示，各自標 _source）
  useEffect(() => {
    // 待 fetch 的來源清單：有 LIFF userId → 加個人；有任何已知群組 → 加群組
    const targets: { sourceId: string; type: 'personal' | 'group' }[] = [];
    if (sourceId) targets.push({ sourceId, type: 'personal' });
    for (const c of knownGroupCtxs) targets.push({ sourceId: c, type: 'group' });

    if (targets.length === 0) {
      // 沒 userId 又沒群組 ctx → 真的什麼都查不到（例如在一般瀏覽器開無 ctx URL）
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    Promise.all(
      targets.map(t =>
        fetch(`/api/subscriptions?sourceId=${encodeURIComponent(t.sourceId)}`)
          .then(r => r.json())
          .then(data => ({ data, type: t.type }))
          .catch(() => ({ data: { ok: false, subscriptions: [] }, type: t.type }))
      )
    )
      .then(results => {
        const merged: ItemWithSource[] = [];
        const seenIds = new Set<number>();
        for (const { data, type } of results) {
          if (!data.ok || !Array.isArray(data.subscriptions)) continue;
          for (const sub of data.subscriptions as Subscription[]) {
            if (sub.id != null && seenIds.has(sub.id)) continue;
            if (sub.id != null) seenIds.add(sub.id);
            merged.push({ ...sub, _source: type });
          }
        }
        setItems(merged);
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [sourceId, groupCtxId, knownGroupCtxs]);

  // 改目標價 — 開啟 modal（取代 native prompt + confirm 串接，UI 直觀看到「傳統另設」勾選）
  const openEditModal = (sub: ItemWithSource) => {
    if (sub.id == null) return;
    const current = Number(sub.max_price);
    const currentTrad = sub.max_price_traditional != null ? Number(sub.max_price_traditional) : null;
    setEditingSub(sub);
    setEditMainPrice(String(current));
    setEditTradEnabled(currentTrad != null);
    setEditTradPrice(String(currentTrad ?? Math.round(current * 2)));  // 預設建議 主×2（符合 LCC vs FS 量級差）
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setEditingSub(null);
  };

  const submitEditPrice = async () => {
    if (!editingSub || editingSub.id == null) return;
    const newPrice = parseInt(editMainPrice.replace(/[^0-9]/g, ''), 10);
    if (isNaN(newPrice) || newPrice <= 0) {
      alert('主目標價：請輸入大於 0 的數字');
      return;
    }
    let newTradPrice: number | null = null;
    if (editTradEnabled) {
      const tradVal = parseInt(editTradPrice.replace(/[^0-9]/g, ''), 10);
      if (isNaN(tradVal) || tradVal <= 0) {
        alert('傳統目標價：請輸入大於 0 的數字');
        return;
      }
      newTradPrice = tradVal;
    }
    const sub = editingSub;
    const subSourceId = sub.source_id ?? groupCtxId ?? sourceId;
    setEditSaving(true);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sub.id,
          sourceId: subSourceId,
          maxPrice: newPrice,
          maxPriceTraditional: newTradPrice  // null = 跟隨主目標
        })
      });
      const data = await res.json();
      if (!data.ok) {
        alert('改價失敗：' + (data.error ?? '未知錯誤'));
        return;
      }
      setItems(prev => prev.map(item =>
        item.id === sub.id ? { ...item, max_price: newPrice, max_price_traditional: newTradPrice } : item
      ));
      setEditingSub(null);
    } catch (err) {
      alert('改價失敗：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setEditSaving(false);
    }
  };


  // 刪除訂閱（合併顯示後，每筆 sub 來源不同，要用該 sub 自己的 source_id）
  const handleDelete = async (subId: number) => {
    if (!sourceId || !window.confirm('確定要取消此訂閱？')) return;

    const target = items.find(i => i.id === subId);
    const subSourceId = target?.source_id ?? groupCtxId ?? sourceId;

    setDeleting(subId);
    try {
      // 後端 API 用 query params，不是 path style
      const url = `/api/subscriptions?id=${subId}&sourceId=${encodeURIComponent(subSourceId)}`;
      const res = await fetch(url, { method: 'DELETE' });

      const data = await res.json();
      if (data.ok) {
        setItems(prev => prev.filter(item => item.id !== subId));
      } else {
        setError(data.error || '取消失敗');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消失敗');
    } finally {
      setDeleting(null);
    }
  };

  // 按出發地分組
  const groupedItems = useMemo(() => {
    const groups: Record<string, ItemWithSource[]> = {};
    for (const item of items) {
      const key = `${item.origin} → ${item.destination}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [items]);

  if (!liffReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  const isGroupContext = !!groupCtxId && (groupCtxId.startsWith('C') || groupCtxId.startsWith('R'));
  const personalCount = items.filter(i => i._source === 'personal').length;
  const groupCount = items.filter(i => i._source === 'group').length;

  return (
    <>
      <TabNav active="subscriptions" liffId={liffId} />
      <div className="subs-wrap">
        <header className="subs-header">
          <h1>🔔 我的訂閱</h1>
          <div className="header-badges">
            {personalCount > 0 && <Badge variant="info">個人 {personalCount}</Badge>}
            {groupCount > 0 && <Badge variant="info">群組 {groupCount}</Badge>}
          </div>
        </header>

        {error && <Alert type="error" closable onClose={() => setError(null)}>{error}</Alert>}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="🛫"
            title="還沒有訂閱"
            description={`前往搜尋頁面開始追蹤航班價格${isGroupContext ? '（群組訂閱）' : ''}`}
            action={{
              label: '開始搜尋',
              onClick: () => {
                const ctx = groupCtxId ? `?ctx=${encodeURIComponent(groupCtxId)}` : '';
                window.location.href = `/liff/search${ctx}`;
              }
            }}
          />
        ) : (
          <div className="subs-list">
            {Object.entries(groupedItems).map(([route, subs]) => (
              <div key={route} className="route-group">
                <h2 className="route-title">✈️ {route}</h2>

                <div className="subs-cards">
                  {subs.map(sub => (
                    <div key={sub.id} className="ios-row">
                      <div className="route-visualization">
                        <div className="airport-code">{sub.origin?.slice(0, 3).toUpperCase()}</div>
                        <svg className="route-svg" viewBox="0 0 100 40">
                          <line x1="15" y1="20" x2="75" y2="20" stroke="currentColor" strokeWidth="2" strokeDasharray="5,5" />
                          <circle cx="85" cy="20" r="3" fill="currentColor" />
                          <path d="M 85 20 L 95 15 L 93 20 L 95 25 Z" fill="currentColor" />
                        </svg>
                        <div className="airport-code">{sub.destination?.slice(0, 3).toUpperCase()}</div>
                      </div>
                      <div className="sub-item">
                        <div className="sub-info">
                          <div className="sub-dates">
                            {sub.outbound_date && (
                              <span className="date-badge">
                                🗓️ {new Date(sub.outbound_date).toLocaleDateString('zh-TW')}
                              </span>
                            )}
                            {sub.return_date && (
                              <span className="date-badge">
                                🔄 {new Date(sub.return_date).toLocaleDateString('zh-TW')}
                              </span>
                            )}
                          </div>

                          <div className="sub-price">
                            <span className="price-label">主目標價</span>
                            <span className="price-value">NT$ {sub.max_price.toLocaleString()}</span>
                          </div>
                          {sub.max_price_traditional != null && (
                            <div className="sub-price">
                              <span className="price-label">傳統航空</span>
                              <span className="price-value">NT$ {Number(sub.max_price_traditional).toLocaleString()}</span>
                            </div>
                          )}

                          {sub.label && (
                            <div className="sub-label">📝 {sub.label}</div>
                          )}

                          <div className="sub-status">
                            <Badge variant="info">
                              {sub._source === 'group' ? '👥 群組' : '👤 個人'}
                            </Badge>
                            {sub.active ? (
                              <Badge variant="success">✓ 已啟用</Badge>
                            ) : (
                              <Badge variant="warning">⏸ 已暫停</Badge>
                            )}
                          </div>

                        </div>

                        <div className="sub-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openEditModal(sub)}
                            title="修改目標價"
                          >
                            ✏️ 改價
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => sub.id && handleDelete(sub.id)}
                            disabled={deleting === sub.id}
                            title="取消訂閱"
                          >
                            {deleting === sub.id ? '⏳' : '✕ 取消'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {editingSub && (
          <div className="edit-modal-backdrop" onClick={closeEditModal}>
            <div className="edit-modal" onClick={e => e.stopPropagation()}>
              <div className="edit-modal-header">
                <h2>修改目標價</h2>
                <div className="edit-modal-route">
                  ✈️ {editingSub.origin} → {editingSub.destination}
                </div>
              </div>

              <div className="edit-modal-body">
                <div className="edit-field">
                  <label htmlFor="edit-main-price">主目標價 (NT$)</label>
                  <div className="edit-field-hint">廉航 + 傳統未另設時都用此值</div>
                  <input
                    id="edit-main-price"
                    type="text"
                    inputMode="numeric"
                    value={editMainPrice}
                    onChange={e => setEditMainPrice(e.target.value)}
                    placeholder="例如 15000"
                    autoFocus
                  />
                </div>

                <label className="edit-checkbox-row">
                  <input
                    type="checkbox"
                    checked={editTradEnabled}
                    onChange={e => setEditTradEnabled(e.target.checked)}
                  />
                  <span>傳統航空另設目標價</span>
                </label>

                {editTradEnabled && (
                  <div className="edit-field">
                    <label htmlFor="edit-trad-price">傳統航空目標價 (NT$)</label>
                    <div className="edit-field-hint">星宇 / 長榮 / 華航 等用此值</div>
                    <input
                      id="edit-trad-price"
                      type="text"
                      inputMode="numeric"
                      value={editTradPrice}
                      onChange={e => setEditTradPrice(e.target.value)}
                      placeholder="例如 27000"
                    />
                  </div>
                )}
              </div>

              <div className="edit-modal-actions">
                <button
                  type="button"
                  className="edit-btn-cancel"
                  onClick={closeEditModal}
                  disabled={editSaving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="edit-btn-save"
                  onClick={submitEditPrice}
                  disabled={editSaving}
                >
                  {editSaving ? '儲存中…' : '儲存'}
                </button>
              </div>
            </div>
          </div>
        )}

        <style jsx global>{`
          /* iOS Dark Mode design tokens */
          :root {
            --ios-bg: #000000;
            --ios-bg-secondary: #1c1c1e;
            --ios-bg-tertiary: #2c2c2e;
            --ios-bg-grouped: #1c1c1e;
            --ios-separator: rgba(84, 84, 88, 0.65);
            --ios-separator-opaque: #38383a;
            --ios-label: #ffffff;
            --ios-label-secondary: rgba(235, 235, 245, 0.6);
            --ios-label-tertiary: rgba(235, 235, 245, 0.3);
            --ios-blue: #0a84ff;
            --ios-green: #30d158;
            --ios-orange: #ff9f0a;
            --ios-red: #ff453a;
            --ios-yellow: #ffd60a;
            --ios-purple: #bf5af2;
            --ios-pink: #ff375f;
          }
          body {
            background: var(--ios-bg);
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'PingFang TC', 'Helvetica Neue', sans-serif;
            color: var(--ios-label);
            -webkit-font-smoothing: antialiased;
          }
        `}</style>
        <style jsx>{`
          .subs-wrap {
            max-width: 640px;
            margin: 0 auto;
            padding: 24px 16px 96px;
            background: #000000;
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'PingFang TC', sans-serif;
          }

          .subs-header {
            margin-bottom: 32px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 4px 4px 0;
          }

          .subs-header h1 {
            font-size: 34px;
            font-weight: 700;
            margin: 0;
            color: #ffffff;
            letter-spacing: 0.37px;
            line-height: 41px;
          }

          .header-badges {
            display: flex;
            gap: 6px;
          }

          .subs-list {
            display: flex;
            flex-direction: column;
            gap: 28px;
          }

          .route-group {
            display: flex;
            flex-direction: column;
            gap: 0;
          }

          .route-title {
            font-size: 13px;
            font-weight: 400;
            margin: 0 0 8px 12px;
            color: rgba(235, 235, 245, 0.6);
            letter-spacing: -0.08px;
            text-transform: uppercase;
          }

          .subs-cards {
            background: #1c1c1e;
            border-radius: 14px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }

          .ios-row {
            padding: 16px;
            position: relative;
          }
          .ios-row::after {
            content: '';
            position: absolute;
            left: 16px;
            right: 0;
            bottom: 0;
            height: 0.5px;
            background: rgba(84, 84, 88, 0.65);
          }
          .ios-row:last-child::after {
            display: none;
          }

          .route-visualization {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 10px 14px;
            background: rgba(120, 120, 128, 0.16);
            border-radius: 10px;
            margin-bottom: 12px;
          }

          .airport-code {
            font-size: 13px;
            font-weight: 600;
            color: #0a84ff;
            min-width: 32px;
            text-align: center;
            letter-spacing: 0.5px;
            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
          }

          .route-svg {
            flex: 1;
            height: 28px;
            color: rgba(10, 132, 255, 0.5);
          }

          .sub-item {
            display: flex;
            justify-content: space-between;
            align-items: stretch;
            gap: 12px;
          }

          .sub-info {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 0;
          }

          .sub-actions {
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex-shrink: 0;
            justify-content: flex-start;
          }

          .sub-dates {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
          }

          .date-badge {
            font-size: 13px;
            background: rgba(120, 120, 128, 0.24);
            color: rgba(235, 235, 245, 0.9);
            padding: 4px 10px;
            border-radius: 6px;
            font-weight: 500;
            letter-spacing: -0.08px;
          }

          .sub-price {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            padding: 8px 0;
          }

          .price-label {
            font-size: 13px;
            color: rgba(235, 235, 245, 0.6);
            font-weight: 400;
            letter-spacing: -0.08px;
          }

          .price-value {
            font-size: 22px;
            font-weight: 600;
            color: #ffffff;
            letter-spacing: 0.35px;
            font-feature-settings: 'tnum' 1;
          }

          .sub-label {
            font-size: 13px;
            color: rgba(235, 235, 245, 0.6);
            padding: 6px 10px;
            background: rgba(120, 120, 128, 0.16);
            border-radius: 6px;
            max-width: 100%;
            word-break: break-word;
            font-weight: 400;
          }

          .sub-status {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
          }

          /* Apple-style buttons override (sub-actions only) */
          .sub-actions :global(button) {
            background: rgba(120, 120, 128, 0.24) !important;
            color: #ffffff !important;
            border: none !important;
            border-radius: 8px !important;
            padding: 6px 12px !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            min-height: 32px !important;
            letter-spacing: -0.08px !important;
            transition: opacity 0.2s ease !important;
          }
          .sub-actions :global(button:hover) {
            opacity: 0.7;
          }
          .sub-actions :global(button:disabled) {
            opacity: 0.4;
          }

          /* iOS-style modal */
          .edit-modal-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .edit-modal {
            background: #1c1c1e;
            border-radius: 16px;
            width: 100%;
            max-width: 360px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            border: 0.5px solid rgba(84, 84, 88, 0.65);
          }
          .edit-modal-header {
            padding: 18px 20px 12px;
            text-align: center;
            border-bottom: 0.5px solid rgba(84, 84, 88, 0.65);
          }
          .edit-modal-header h2 {
            font-size: 17px;
            font-weight: 600;
            color: #ffffff;
            margin: 0 0 4px;
            letter-spacing: -0.41px;
          }
          .edit-modal-route {
            font-size: 13px;
            color: rgba(235, 235, 245, 0.6);
            letter-spacing: -0.08px;
          }
          .edit-modal-body {
            padding: 16px 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .edit-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .edit-field label {
            font-size: 13px;
            font-weight: 500;
            color: rgba(235, 235, 245, 0.9);
            letter-spacing: -0.08px;
          }
          .edit-field-hint {
            font-size: 11px;
            color: rgba(235, 235, 245, 0.45);
            letter-spacing: -0.06px;
            margin-bottom: 4px;
          }
          .edit-field input[type="text"] {
            background: rgba(120, 120, 128, 0.24);
            border: none;
            border-radius: 10px;
            padding: 12px 14px;
            color: #ffffff;
            font-size: 17px;
            font-weight: 500;
            font-feature-settings: 'tnum' 1;
            outline: none;
            transition: background 0.15s ease;
          }
          .edit-field input[type="text"]:focus {
            background: rgba(120, 120, 128, 0.36);
          }
          .edit-checkbox-row {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            background: rgba(120, 120, 128, 0.16);
            border-radius: 10px;
            cursor: pointer;
            user-select: none;
          }
          .edit-checkbox-row input[type="checkbox"] {
            width: 20px;
            height: 20px;
            accent-color: #0a84ff;
            margin: 0;
            cursor: pointer;
          }
          .edit-checkbox-row span {
            font-size: 15px;
            color: #ffffff;
            letter-spacing: -0.24px;
          }
          .edit-modal-actions {
            display: flex;
            border-top: 0.5px solid rgba(84, 84, 88, 0.65);
          }
          .edit-modal-actions button {
            flex: 1;
            background: transparent;
            border: none;
            padding: 14px;
            font-size: 17px;
            color: #0a84ff;
            cursor: pointer;
            letter-spacing: -0.41px;
            transition: background 0.15s ease;
          }
          .edit-modal-actions button:hover:not(:disabled) {
            background: rgba(120, 120, 128, 0.16);
          }
          .edit-modal-actions button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
          .edit-btn-cancel {
            color: rgba(235, 235, 245, 0.6) !important;
            border-right: 0.5px solid rgba(84, 84, 88, 0.65) !important;
          }
          .edit-btn-save {
            font-weight: 600 !important;
          }

          @media (max-width: 640px) {
            .subs-wrap {
              padding: 16px 12px 96px;
            }
            .subs-header h1 {
              font-size: 28px;
              line-height: 34px;
            }
          }
        `}</style>
      </div>
    </>
  );
}
