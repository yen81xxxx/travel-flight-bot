'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { useLiff } from '@/hooks/useLiff';
import { Alert, Badge, Button, Card, EmptyState, Spinner } from '@/components';
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

  // 群組上下文
  const [groupCtxId, setGroupCtxId] = useSessionStorage<string | null>('liff_ctx', null);

  // 訂閱數據
  const [items, setItems] = useState<ItemWithSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  // 初始化群組 ID
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get('ctx');
    if (ctx && (ctx.startsWith('C') || ctx.startsWith('R'))) {
      setGroupCtxId(ctx);
    }
  }, [setGroupCtxId]);

  // 加載訂閱列表
  useEffect(() => {
    if (!sourceId) return;

    const targetSourceId = groupCtxId ?? sourceId;
    setLoading(true);
    setError(null);

    fetch(`/api/subscriptions?sourceId=${encodeURIComponent(targetSourceId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && Array.isArray(data.subscriptions)) {
          const source: 'group' | 'personal' = groupCtxId ? 'group' : 'personal';
          const withSource = data.subscriptions.map((sub: Subscription) => ({
            ...sub,
            _source: source
          }));
          setItems(withSource);
        } else {
          setError(data.error || '加載失敗');
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [sourceId, groupCtxId]);

  // 刪除訂閱
  const handleDelete = async (subId: number) => {
    if (!sourceId || !window.confirm('確定要取消此訂閱？')) return;

    setDeleting(subId);
    try {
      const res = await fetch(`/api/subscriptions/${subId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: groupCtxId ?? sourceId })
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

  return (
    <>
      <TabNav active="subscriptions" liffId={liffId} />
      <div className="subs-wrap">
        <header className="subs-header">
          <h1>🔔 我的訂閱</h1>
          {isGroupContext && <Badge variant="info">群組訂閱</Badge>}
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
                            {sub.active ? (
                              <Badge variant="success">✓ 已啟用</Badge>
                            ) : (
                              <Badge variant="warning">⏸ 已暫停</Badge>
                            )}
                          </div>
                        </div>

                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => sub.id && handleDelete(sub.id)}
                          disabled={deleting === sub.id}
                        >
                          {deleting === sub.id ? '⏳' : '✕'}
                        </Button>
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
          }

          .subs-header {
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .subs-header h1 {
            font-size: 28px;
            font-weight: 700;
            margin: 0;
          }

          .subs-list {
            display: flex;
            flex-direction: column;
            gap: 24px;
          }

          .route-group {
            margin-bottom: 16px;
          }

          .route-title {
            font-size: 16px;
            font-weight: 600;
            margin: 0 0 12px;
            color: #333;
          }

          .subs-cards {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .sub-item {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
          }

          .sub-info {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .sub-dates {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }

          .date-badge {
            font-size: 12px;
            background: #f0f4ff;
            color: #0066ff;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: 500;
          }

          .sub-price {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .price-label {
            font-size: 12px;
            color: #6b7280;
            font-weight: 500;
          }

          .price-value {
            font-size: 18px;
            font-weight: 700;
            color: #ff7a45;
          }

          .sub-label {
            font-size: 13px;
            color: #666;
            padding: 6px 10px;
            background: #f9f9f9;
            border-radius: 4px;
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
