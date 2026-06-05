'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { useKnownGroupCtxs } from '@/hooks/useKnownGroupCtxs';
import { useLiff } from '@/hooks/useLiff';
import { Alert, EmptyState, Spinner } from '@/components';
import type { Subscription } from '@/types';
import { getCity } from '@/config/airports';
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

  // 編輯 modal 狀態（目標價 + 傳統另設 + 時間過濾）
  const [editingSub, setEditingSub] = useState<ItemWithSource | null>(null);
  const [editMainPrice, setEditMainPrice] = useState<string>('');
  const [editTradEnabled, setEditTradEnabled] = useState<boolean>(false);
  const [editTradPrice, setEditTradPrice] = useState<string>('');
  const [editTimeFilterEnabled, setEditTimeFilterEnabled] = useState<boolean>(false);
  const [editOutboundMinTime, setEditOutboundMinTime] = useState<string>('');
  const [editReturnMinTime, setEditReturnMinTime] = useState<string>('');
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
    const currentOutTime = sub.outbound_min_departure_time ?? null;
    const currentRetTime = sub.return_min_departure_time ?? null;
    setEditingSub(sub);
    setEditMainPrice(String(current));
    setEditTradEnabled(currentTrad != null);
    setEditTradPrice(String(currentTrad ?? Math.round(current * 2)));  // 預設建議 主×2（符合 LCC vs FS 量級差）
    setEditTimeFilterEnabled(currentOutTime != null || currentRetTime != null);
    setEditOutboundMinTime(currentOutTime ?? '08:00');
    setEditReturnMinTime(currentRetTime ?? '08:00');
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setEditingSub(null);
  };

  // 正規化使用者輸入的時間字串為 HH:MM。
  // 接受 '12', '1200', '12:00', '12.30' 等，invalid 回 null。
  const normalizeHHMM = (raw: string): string | null => {
    const s = raw.trim();
    if (!s) return null;
    // 已是 HH:MM
    const m1 = s.match(/^(\d{1,2}):(\d{2})$/);
    // 純數字 4 位 = HHMM
    const m2 = s.match(/^(\d{1,2})(\d{2})$/);
    // 純數字 1~2 位 = 小時，分鐘 00
    const m3 = s.match(/^(\d{1,2})$/);
    let h: number, m: number;
    if (m1) { h = +m1[1]; m = +m1[2]; }
    else if (m2) { h = +m2[1]; m = +m2[2]; }
    else if (m3) { h = +m3[1]; m = 0; }
    else return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
    // 時間過濾：勾選時兩個必須都輸入合法（去程 + 回程），不勾就清空兩個
    let newOutTime: string | null = null;
    let newRetTime: string | null = null;
    if (editTimeFilterEnabled) {
      const o = normalizeHHMM(editOutboundMinTime);
      const r = normalizeHHMM(editReturnMinTime);
      if (!o) {
        alert('去程最早起飛時間格式錯誤，例如 12:00');
        return;
      }
      if (!r) {
        alert('回程最早起飛時間格式錯誤，例如 12:00');
        return;
      }
      newOutTime = o;
      newRetTime = r;
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
          maxPriceTraditional: newTradPrice,                    // null = 跟隨主目標
          outboundMinDepartureTime: newOutTime,                  // null = 不過濾
          returnMinDepartureTime: newRetTime                     // null = 不過濾
        })
      });
      const data = await res.json();
      if (!data.ok) {
        alert('儲存失敗：' + (data.error ?? '未知錯誤'));
        return;
      }
      setItems(prev => prev.map(item =>
        item.id === sub.id
          ? {
              ...item,
              max_price: newPrice,
              max_price_traditional: newTradPrice,
              outbound_min_departure_time: newOutTime,
              return_min_departure_time: newRetTime
            }
          : item
      ));
      setEditingSub(null);
    } catch (err) {
      alert('儲存失敗：' + (err instanceof Error ? err.message : String(err)));
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
          <div>
            <div className="subs-eyebrow">FLIGHT TRACKER</div>
            <h1>我的訂閱</h1>
          </div>
          <div className="header-counters">
            {personalCount > 0 && (
              <div className="counter-pill"><strong>{personalCount}</strong> 個人</div>
            )}
            {groupCount > 0 && (
              <div className="counter-pill counter-pill-group"><strong>{groupCount}</strong> 群組</div>
            )}
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
            {Object.entries(groupedItems).map(([route, subs]) => {
              const first = subs[0];
              const originCity = getCity(first.origin);
              const destCity = getCity(first.destination);
              return (
                <section key={route} className="route-group">
                  <header className="route-header">
                    <div className="route-cities">
                      <span className="route-city">{originCity}</span>
                      <svg className="route-plane-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="currentColor" />
                      </svg>
                      <span className="route-city">{destCity}</span>
                    </div>
                    <div className="route-codes">{first.origin} → {first.destination}</div>
                  </header>

                  <div className="cards-stack">
                    {subs.map(sub => {
                      const outDate = sub.outbound_date ? new Date(sub.outbound_date) : null;
                      const retDate = sub.return_date ? new Date(sub.return_date) : null;
                      const daysUntil = outDate
                        ? Math.ceil((outDate.getTime() - Date.now()) / 86_400_000)
                        : null;
                      const fmtMD = (d: Date) =>
                        d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
                      const fmtY = (d: Date) => String(d.getFullYear());

                      return (
                        <article key={sub.id} className={`sub-card ${sub.active ? '' : 'is-paused'}`}>
                          <div className="card-head">
                            <div className="card-dates">
                              {outDate && (
                                <div className="date-block">
                                  <div className="date-label">出發</div>
                                  <div className="date-value">
                                    <span className="date-md">{fmtMD(outDate)}</span>
                                    <span className="date-year">{fmtY(outDate)}</span>
                                  </div>
                                </div>
                              )}
                              {retDate && (
                                <>
                                  <div className="date-sep" aria-hidden="true">·</div>
                                  <div className="date-block">
                                    <div className="date-label">回程</div>
                                    <div className="date-value">
                                      <span className="date-md">{fmtMD(retDate)}</span>
                                      <span className="date-year">{fmtY(retDate)}</span>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                            <div className={`source-pill ${sub._source === 'group' ? 'is-group' : 'is-personal'}`}>
                              {sub._source === 'group' ? '群組' : '個人'}
                            </div>
                          </div>

                          {daysUntil != null && daysUntil >= 0 && (
                            <div className="countdown-strip">
                              ⏳ 距離出發 <strong>{daysUntil}</strong> 天
                            </div>
                          )}

                          <div className="price-block">
                            <div className="price-row price-row-main">
                              <div className="price-row-label">
                                {sub.max_price_traditional != null ? (
                                  <>
                                    <span className="price-tag price-tag-lcc">廉航</span>
                                    <span className="price-row-hint">捷星 / 酷航</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="price-row-title">目標價</span>
                                    <span className="price-row-hint">廉航 / 傳統 共用</span>
                                  </>
                                )}
                              </div>
                              <div className="price-row-value price-row-value-main">
                                <span className="ccy">NT$</span>
                                {sub.max_price.toLocaleString()}
                              </div>
                            </div>
                            {sub.max_price_traditional != null && (
                              <div className="price-row price-row-trad">
                                <div className="price-row-label">
                                  <span className="price-tag price-tag-trad">傳統</span>
                                  <span className="price-row-hint">星宇 / 長榮</span>
                                </div>
                                <div className="price-row-value price-row-value-trad">
                                  <span className="ccy">NT$</span>
                                  {Number(sub.max_price_traditional).toLocaleString()}
                                </div>
                              </div>
                            )}
                          </div>

                          {(sub.outbound_min_departure_time || sub.return_min_departure_time) && (
                            <div className="card-timefilter">
                              <span className="card-timefilter-icon">🌙</span>
                              <span>
                                排除清晨：去 {sub.outbound_min_departure_time ?? '不限'} 前
                                {' · '}
                                回 {sub.return_min_departure_time ?? '不限'} 前
                              </span>
                            </div>
                          )}

                          {sub.label && (
                            <div className="card-note">📝 {sub.label}</div>
                          )}

                          <div className="card-foot">
                            <div className="status-line">
                              <span className={`status-dot ${sub.active ? 'is-on' : 'is-off'}`} />
                              <span className="status-text">{sub.active ? '監控中' : '已暫停'}</span>
                            </div>
                            <div className="card-actions">
                              <button
                                type="button"
                                className="link-btn link-btn-primary"
                                onClick={() => openEditModal(sub)}
                              >
                                編輯
                              </button>
                              <span className="action-sep" aria-hidden="true" />
                              <button
                                type="button"
                                className="link-btn link-btn-danger"
                                onClick={() => sub.id && handleDelete(sub.id)}
                                disabled={deleting === sub.id}
                              >
                                {deleting === sub.id ? '取消中…' : '取消訂閱'}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {editingSub && (
          <div className="edit-modal-backdrop" onClick={closeEditModal}>
            <div className="edit-modal" onClick={e => e.stopPropagation()}>
              <div className="edit-modal-header">
                <h2>編輯訂閱</h2>
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
                    <div className="edit-field-hint">星宇 / 長榮 等用此值</div>
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

                <label className="edit-checkbox-row">
                  <input
                    type="checkbox"
                    checked={editTimeFilterEnabled}
                    onChange={e => setEditTimeFilterEnabled(e.target.checked)}
                  />
                  <span>排除過早出發的航班</span>
                </label>

                {editTimeFilterEnabled && (
                  <div className="edit-time-grid">
                    <div className="edit-field">
                      <label htmlFor="edit-out-time">去程最早</label>
                      <div className="edit-field-hint">早於此時刻起飛 → 不通知</div>
                      <input
                        id="edit-out-time"
                        type="time"
                        value={editOutboundMinTime}
                        onChange={e => setEditOutboundMinTime(e.target.value)}
                      />
                    </div>
                    <div className="edit-field">
                      <label htmlFor="edit-ret-time">回程最早</label>
                      <div className="edit-field-hint">早於此時刻起飛 → 不通知</div>
                      <input
                        id="edit-ret-time"
                        type="time"
                        value={editReturnMinTime}
                        onChange={e => setEditReturnMinTime(e.target.value)}
                      />
                    </div>
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

          /* ===== Header ===== */
          .subs-header {
            margin-bottom: 28px;
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 12px;
            padding: 4px 4px 0;
          }
          .subs-eyebrow {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 1.6px;
            color: #0a84ff;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .subs-header h1 {
            font-size: 32px;
            font-weight: 700;
            margin: 0;
            color: #ffffff;
            letter-spacing: -0.4px;
            line-height: 1.1;
          }
          .header-counters {
            display: flex;
            gap: 6px;
            flex-shrink: 0;
          }
          .counter-pill {
            font-size: 12px;
            font-weight: 500;
            color: rgba(235, 235, 245, 0.75);
            background: rgba(120, 120, 128, 0.24);
            padding: 6px 10px;
            border-radius: 8px;
            letter-spacing: -0.08px;
            display: inline-flex;
            align-items: baseline;
            gap: 4px;
          }
          .counter-pill strong {
            color: #ffffff;
            font-weight: 700;
            font-size: 13px;
          }
          .counter-pill-group strong {
            color: #bf5af2;
          }

          /* ===== Group ===== */
          .subs-list {
            display: flex;
            flex-direction: column;
            gap: 32px;
          }
          .route-group {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .route-header {
            padding: 0 8px;
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 12px;
          }
          .route-cities {
            display: flex;
            align-items: center;
            gap: 10px;
            color: #ffffff;
            font-size: 20px;
            font-weight: 600;
            letter-spacing: -0.3px;
          }
          .route-city {
            line-height: 1;
          }
          .route-plane-icon {
            width: 16px;
            height: 16px;
            color: rgba(10, 132, 255, 0.85);
            flex-shrink: 0;
          }
          .route-codes {
            font-size: 11px;
            font-weight: 600;
            color: rgba(235, 235, 245, 0.4);
            letter-spacing: 1px;
            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
          }

          /* ===== Cards stack ===== */
          .cards-stack {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          /* ===== Single card ===== */
          .sub-card {
            background: linear-gradient(180deg, #1f1f22 0%, #1a1a1d 100%);
            border-radius: 16px;
            border: 0.5px solid rgba(84, 84, 88, 0.45);
            padding: 16px 16px 4px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset,
                        0 6px 16px rgba(0, 0, 0, 0.18);
            transition: opacity 0.2s ease;
          }
          .sub-card.is-paused {
            opacity: 0.55;
          }

          /* card head: dates + source pill */
          .card-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
          }
          .card-dates {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          }
          .date-block {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .date-label {
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.8px;
            color: rgba(235, 235, 245, 0.45);
            text-transform: uppercase;
          }
          .date-value {
            display: flex;
            align-items: baseline;
            gap: 6px;
          }
          .date-md {
            font-size: 17px;
            font-weight: 600;
            color: #ffffff;
            letter-spacing: -0.2px;
            font-feature-settings: 'tnum' 1;
          }
          .date-year {
            font-size: 11px;
            color: rgba(235, 235, 245, 0.4);
            font-feature-settings: 'tnum' 1;
            letter-spacing: -0.06px;
          }
          .date-sep {
            color: rgba(235, 235, 245, 0.3);
            font-size: 14px;
            align-self: center;
            padding-top: 14px;
          }
          .source-pill {
            font-size: 11px;
            font-weight: 600;
            padding: 4px 9px;
            border-radius: 999px;
            letter-spacing: -0.06px;
            flex-shrink: 0;
          }
          .source-pill.is-personal {
            color: #0a84ff;
            background: rgba(10, 132, 255, 0.16);
          }
          .source-pill.is-group {
            color: #bf5af2;
            background: rgba(191, 90, 242, 0.16);
          }

          /* countdown strip */
          .countdown-strip {
            font-size: 12px;
            color: rgba(255, 159, 10, 0.95);
            background: rgba(255, 159, 10, 0.12);
            padding: 7px 12px;
            border-radius: 8px;
            letter-spacing: -0.06px;
          }
          .countdown-strip strong {
            font-weight: 700;
            color: #ffd60a;
            font-feature-settings: 'tnum' 1;
            margin: 0 2px;
          }

          /* price block */
          .price-block {
            display: flex;
            flex-direction: column;
            gap: 0;
            padding: 14px;
            background: rgba(120, 120, 128, 0.10);
            border-radius: 12px;
          }
          .price-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 4px 0;
          }
          .price-row-trad {
            padding-top: 12px;
            margin-top: 8px;
            border-top: 0.5px dashed rgba(235, 235, 245, 0.14);
          }
          .price-row-label {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
          }
          .price-row-title {
            font-size: 13px;
            font-weight: 600;
            color: #ffffff;
            letter-spacing: -0.08px;
          }
          .price-row-hint {
            font-size: 11px;
            color: rgba(235, 235, 245, 0.5);
            letter-spacing: -0.06px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .price-tag {
            font-size: 10px;
            font-weight: 700;
            padding: 3px 7px;
            border-radius: 5px;
            letter-spacing: 0.5px;
            flex-shrink: 0;
          }
          .price-tag-lcc {
            color: #64d2ff;
            background: rgba(100, 210, 255, 0.16);
          }
          .price-tag-trad {
            color: #ffd60a;
            background: rgba(255, 214, 10, 0.14);
          }
          .price-row-value {
            font-feature-settings: 'tnum' 1;
            display: flex;
            align-items: baseline;
            gap: 4px;
            white-space: nowrap;
          }
          .price-row-value-main {
            font-size: 24px;
            font-weight: 700;
            color: #ffffff;
            letter-spacing: -0.3px;
          }
          .price-row-value-trad {
            font-size: 18px;
            font-weight: 600;
            color: rgba(235, 235, 245, 0.88);
            letter-spacing: -0.2px;
          }
          .ccy {
            font-size: 12px;
            font-weight: 500;
            color: rgba(235, 235, 245, 0.55);
            letter-spacing: 0.4px;
          }

          /* time filter strip */
          .card-timefilter {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: rgba(100, 210, 255, 0.85);
            background: rgba(100, 210, 255, 0.10);
            padding: 7px 12px;
            border-radius: 8px;
            letter-spacing: -0.06px;
            font-feature-settings: 'tnum' 1;
          }
          .card-timefilter-icon {
            flex-shrink: 0;
          }

          /* note */
          .card-note {
            font-size: 12px;
            color: rgba(235, 235, 245, 0.6);
            padding: 8px 12px;
            background: rgba(120, 120, 128, 0.10);
            border-radius: 8px;
            word-break: break-word;
          }

          /* footer: status + actions */
          .card-foot {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 6px 4px 8px;
            border-top: 0.5px solid rgba(84, 84, 88, 0.35);
            margin-top: 2px;
            padding-top: 12px;
          }
          .status-line {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: rgba(235, 235, 245, 0.7);
            letter-spacing: -0.06px;
          }
          .status-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            display: inline-block;
          }
          .status-dot.is-on {
            background: #30d158;
            box-shadow: 0 0 6px rgba(48, 209, 88, 0.5);
          }
          .status-dot.is-off {
            background: rgba(235, 235, 245, 0.35);
          }
          .status-text {
            font-weight: 500;
          }
          .card-actions {
            display: flex;
            align-items: center;
            gap: 4px;
          }
          .link-btn {
            background: transparent;
            border: none;
            font-size: 14px;
            font-weight: 500;
            padding: 6px 10px;
            border-radius: 6px;
            cursor: pointer;
            letter-spacing: -0.08px;
            transition: background 0.15s ease;
          }
          .link-btn-primary {
            color: #0a84ff;
          }
          .link-btn-danger {
            color: #ff453a;
          }
          .link-btn:hover:not(:disabled) {
            background: rgba(120, 120, 128, 0.16);
          }
          .link-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
          .action-sep {
            width: 0.5px;
            height: 14px;
            background: rgba(84, 84, 88, 0.65);
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
          .edit-field input[type="text"],
          .edit-field input[type="time"] {
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
            font-family: inherit;
          }
          .edit-field input[type="text"]:focus,
          .edit-field input[type="time"]:focus {
            background: rgba(120, 120, 128, 0.36);
          }
          /* iOS Safari 時間 picker 文字色 */
          .edit-field input[type="time"]::-webkit-calendar-picker-indicator {
            filter: invert(1) brightness(0.85);
          }
          .edit-time-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
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
            }
            .route-cities {
              font-size: 18px;
            }
            .price-row-value-main {
              font-size: 22px;
            }
            .price-row-value-trad {
              font-size: 16px;
            }
            .sub-card {
              padding: 14px 14px 4px;
            }
          }
        `}</style>
      </div>
    </>
  );
}
