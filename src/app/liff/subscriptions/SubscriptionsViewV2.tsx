'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { useKnownGroupCtxs } from '@/hooks/useKnownGroupCtxs';
import { useLiff } from '@/hooks/useLiff';
import { Alert, Badge, Button, EmptyState, Spinner } from '@/components';
import type { Subscription } from '@/types';
import TabNav from '../TabNav';
import Sparkline from './Sparkline';

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

  // 改目標價（彈出 prompt 輸入新價，呼 PATCH /api/subscriptions）
  const handleEditPrice = async (sub: ItemWithSource) => {
    if (sub.id == null) return;
    const current = Number(sub.max_price);
    const input = window.prompt(
      `修改「${sub.origin}→${sub.destination}」目標價（當前 NT$ ${current.toLocaleString()}）\n\n` +
      '輸入新的目標價（NT$）：',
      String(current)
    );
    if (input == null) return;  // user cancelled
    const newPrice = parseInt(input.replace(/[^0-9]/g, ''), 10);
    if (isNaN(newPrice) || newPrice <= 0) {
      alert('請輸入大於 0 的數字');
      return;
    }
    if (newPrice === current) return;  // no change

    const subSourceId = sub.source_id ?? groupCtxId ?? sourceId;
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, sourceId: subSourceId, maxPrice: newPrice })
      });
      const data = await res.json();
      if (!data.ok) {
        alert('改價失敗：' + (data.error ?? '未知錯誤'));
        return;
      }
      // 更新 local state（避免要重 fetch 整列）
      setItems(prev => prev.map(item =>
        item.id === sub.id ? { ...item, max_price: newPrice } : item
      ));
    } catch (err) {
      alert('改價失敗：' + (err instanceof Error ? err.message : String(err)));
    }
  };


  // 刪除訂閱（合併顯示後，每筆 sub 來源不同，要用該 sub 自己的 source_id）
  const handleDelete = async (subId: number) => {
    if (!sourceId || !window.confirm('確定要取消此訂閱？')) return;

    const target = items.find(i => i.id === subId);
    const subSourceId = target?.source_id ?? groupCtxId ?? sourceId;

    setDeleting(subId);
    try {
      const res = await fetch(`/api/subscriptions/${subId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: subSourceId })
      });

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
                            <span className="price-label">預設通知價格</span>
                            <span className="price-value">NT$ {sub.max_price.toLocaleString()}</span>
                          </div>

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

                          <Sparkline
                            origin={sub.origin}
                            destination={sub.destination}
                            outboundDate={sub.outbound_date}
                            returnDate={sub.return_date}
                            threshold={Number(sub.max_price)}
                          />
                        </div>

                        <div className="sub-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleEditPrice(sub)}
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
