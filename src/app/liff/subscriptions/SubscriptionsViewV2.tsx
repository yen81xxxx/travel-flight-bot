'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { useKnownGroupCtxs } from '@/hooks/useKnownGroupCtxs';
import { useLiff } from '@/hooks/useLiff';
import { Alert, Badge, Button, Card, EmptyState, Spinner } from '@/components';
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

  // 分享訂閱給朋友（用 liff.shareTargetPicker）
  const handleShare = async (sub: ItemWithSource) => {
    try {
      const { default: liff } = await import('@line/liff');
      // 沒登入或不在 LINE 內 → 給 fallback 提示
      if (!liff.isInClient() && typeof window !== 'undefined') {
        alert('請從 LINE 內開啟才能分享給朋友');
        return;
      }
      if (typeof (liff as { shareTargetPicker?: unknown }).shareTargetPicker !== 'function') {
        alert('你的 LIFF 版本不支援分享');
        return;
      }
      const route = `${sub.origin}→${sub.destination}`;
      const dates = `${sub.outbound_date ?? ''}~${sub.return_date ?? ''}`;
      const flexMsg = {
        type: 'flex' as const,
        altText: `✈️ 我在追 ${route} ${dates}`,
        contents: {
          type: 'bubble' as const,
          size: 'kilo' as const,
          header: {
            type: 'box' as const,
            layout: 'vertical' as const,
            backgroundColor: '#1a2238',
            paddingAll: '12px',
            contents: [
              { type: 'text' as const, text: '✈️ 我發現一條好航線', weight: 'bold' as const, size: 'md' as const, color: '#ffffff' }
            ]
          },
          body: {
            type: 'box' as const,
            layout: 'vertical' as const,
            spacing: 'sm' as const,
            contents: [
              { type: 'text' as const, text: route, weight: 'bold' as const, size: 'lg' as const, color: '#1a2238' },
              { type: 'text' as const, text: `📅 ${dates}`, size: 'sm' as const, color: '#666666' },
              { type: 'text' as const, text: `🎯 我設的目標價 NT$ ${Number(sub.max_price).toLocaleString()}`, size: 'sm' as const, color: '#22c55e', wrap: true, margin: 'md' as const },
              { type: 'text' as const, text: '也想追同條航線？加我們的 bot 就會每天通知最低價', size: 'xs' as const, color: '#94a3b8', wrap: true, margin: 'md' as const }
            ]
          },
          footer: {
            type: 'box' as const,
            layout: 'vertical' as const,
            contents: [
              {
                type: 'button' as const,
                style: 'primary' as const,
                color: '#1a2238',
                height: 'sm' as const,
                action: {
                  type: 'uri' as const,
                  label: '👉 加 bot 開始追',
                  uri: typeof window !== 'undefined' ? window.location.origin + '/liff/search' : 'https://travel-flight-bot.vercel.app/liff/search'
                }
              }
            ]
          }
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (liff as any).shareTargetPicker([flexMsg], { isMultiple: true });
      if (result && result.status === 'success') {
        // user shared successfully — no need to alert (LINE 已自帶 toast)
      }
    } catch (err) {
      console.error('share failed:', err);
      alert('分享失敗：' + (err instanceof Error ? err.message : String(err)));
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
                    <Card key={sub.id}>
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
                            onClick={() => handleShare(sub)}
                            title="分享給朋友"
                          >
                            📤
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => sub.id && handleDelete(sub.id)}
                            disabled={deleting === sub.id}
                            title="取消訂閱"
                          >
                            {deleting === sub.id ? '⏳' : '✕'}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <style jsx>{`
          .subs-wrap {
            max-width: 600px;
            margin: 0 auto;
            padding: 16px;
            padding-bottom: 80px;
            background: linear-gradient(180deg, #f8f9fa 0%, #ffffff 100%);
            min-height: 100vh;
          }

          .subs-header {
            margin-bottom: 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            background: linear-gradient(135deg, #001a4d 0%, #1a3a66 100%);
            border-radius: 16px;
            padding: 28px;
            border: 1px solid rgba(0, 102, 255, 0.3);
            box-shadow: 0 8px 32px rgba(0, 102, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          }

          .subs-header h1 {
            font-size: 28px;
            font-weight: 800;
            margin: 0;
            color: #ffffff;
            letter-spacing: -0.5px;
          }

          .subs-list {
            display: flex;
            flex-direction: column;
            gap: 24px;
          }

          .route-group {
            margin-bottom: 20px;
          }

          .route-title {
            font-size: 16px;
            font-weight: 700;
            margin: 0 0 12px;
            color: #1f2937;
            letter-spacing: -0.3px;
          }

          .subs-cards {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .route-visualization {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 12px;
            background: linear-gradient(135deg, #f0f4ff 0%, #e8f0ff 100%);
            border-radius: 8px;
            margin-bottom: 12px;
            border: 1px solid #d9e3ff;
          }

          .airport-code {
            font-size: 12px;
            font-weight: 800;
            color: #0066ff;
            min-width: 32px;
            text-align: center;
            font-family: 'Courier New', monospace;
          }

          .route-svg {
            flex: 1;
            height: 30px;
            color: #0066ff;
            opacity: 0.7;
          }

          .sub-item {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            transition: all 0.2s ease;
          }

          .sub-item:hover {
            transform: translateX(2px);
          }

          .sub-info {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .sub-actions {
            display: flex;
            flex-direction: column;
            gap: 6px;
            flex-shrink: 0;
          }

          .sub-dates {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }

          .date-badge {
            font-size: 11px;
            background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
            color: #0369a1;
            padding: 6px 12px;
            border-radius: 6px;
            font-weight: 600;
            border: 1px solid rgba(3, 105, 161, 0.2);
            box-shadow: 0 1px 3px rgba(3, 105, 161, 0.1);
          }

          .sub-price {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px;
            background: linear-gradient(135deg, #fff7ed 0%, #ffecdc 100%);
            border-radius: 8px;
          }

          .price-label {
            font-size: 12px;
            color: #92400e;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .price-value {
            font-size: 20px;
            font-weight: 800;
            background: linear-gradient(135deg, #ff7a45 0%, #ff6b35 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          }

          .sub-label {
            font-size: 13px;
            color: #666;
            padding: 8px 12px;
            background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%);
            border: 1px solid #e0e7ff;
            border-radius: 6px;
            max-width: 100%;
            word-break: break-word;
          }

          .sub-status {
            display: flex;
            gap: 6px;
          }

          @media (max-width: 640px) {
            .subs-wrap {
              padding: 12px;
            }

            .subs-header {
              flex-direction: column;
              align-items: flex-start;
            }

            .sub-item {
              flex-direction: column;
            }
          }
        `}</style>
      </div>
    </>
  );
}
