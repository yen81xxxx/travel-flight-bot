'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { useKnownGroupCtxs } from '@/hooks/useKnownGroupCtxs';
import { useLiff } from '@/hooks/useLiff';
import { Alert, EmptyState, Spinner } from '@/components';
import type { Subscription } from '@/types';
import { getCity } from '@/config/airports';
import TabNav from '../TabNav';
import { Icon } from '../_components/Icon';

interface Props {
  liffId: string;
}

type ItemWithSource = Subscription & { _source: 'personal' | 'group' };

/**
 * 把單方向（去 / 回）的時間窗口顯示成可讀區間。
 * 例：
 *   min='12:00' max=null   → '12:00 後'
 *   min=null    max='18:00' → '18:00 前'
 *   min='08:00' max='12:00' → '08:00–12:00'
 *   兩者都 null（不該呼叫到）→ '不限'
 */
function formatWindow(min: string | null | undefined, max: string | null | undefined): string {
  if (min && max) return `${min}–${max}`;
  if (min) return `${min} 後`;
  if (max) return `${max} 前`;
  return '不限';
}

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
  const [editOutboundMaxTime, setEditOutboundMaxTime] = useState<string>('');
  const [editReturnMaxTime, setEditReturnMaxTime] = useState<string>('');
  // editIsOneWay = true → 單程訂閱（不追蹤回程）
  const [editIsOneWay, setEditIsOneWay] = useState<boolean>(false);
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
    const outMin = sub.outbound_min_departure_time ?? null;
    const retMin = sub.return_min_departure_time ?? null;
    const outMax = sub.outbound_max_departure_time ?? null;
    const retMax = sub.return_max_departure_time ?? null;
    setEditingSub(sub);
    setEditMainPrice(String(current));
    setEditTradEnabled(currentTrad != null);
    setEditTradPrice(String(currentTrad ?? Math.round(current * 2)));  // 預設建議 主×2（符合 LCC vs FS 量級差）
    setEditTimeFilterEnabled(!!(outMin || retMin || outMax || retMax));
    setEditOutboundMinTime(outMin ?? '');
    setEditReturnMinTime(retMin ?? '');
    setEditOutboundMaxTime(outMax ?? '');
    setEditReturnMaxTime(retMax ?? '');
    setEditIsOneWay(sub.return_date == null);
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
    // 時段窗口：勾選時 4 格皆可空（空 = 該端不限），不勾選就全清空
    // 任一格有值要驗格式；同一段 min/max 同時設要 min <= max
    let newOutMin: string | null = null;
    let newRetMin: string | null = null;
    let newOutMax: string | null = null;
    let newRetMax: string | null = null;
    if (editTimeFilterEnabled) {
      const parse = (label: string, raw: string): string | false | null => {
        if (!raw.trim()) return null;  // 空 = 不限
        const v = normalizeHHMM(raw);
        if (!v) {
          alert(`${label}：時間格式錯誤，例如 12:00`);
          return false;
        }
        return v;
      };
      const oMin = parse('去程「不早於」', editOutboundMinTime);
      if (oMin === false) return;
      const rMin = parse('回程「不早於」', editReturnMinTime);
      if (rMin === false) return;
      const oMax = parse('去程「不晚於」', editOutboundMaxTime);
      if (oMax === false) return;
      const rMax = parse('回程「不晚於」', editReturnMaxTime);
      if (rMax === false) return;
      // 同段 min/max 都填要合理（min <= max；'HH:MM' 字串字典序 = 數值序）
      if (oMin && oMax && oMin > oMax) {
        alert('去程「不早於」必須早於或等於「不晚於」');
        return;
      }
      if (rMin && rMax && rMin > rMax) {
        alert('回程「不早於」必須早於或等於「不晚於」');
        return;
      }
      newOutMin = oMin; newRetMin = rMin; newOutMax = oMax; newRetMax = rMax;
    }

    const sub = editingSub;
    const subSourceId = sub.source_id ?? groupCtxId ?? sourceId;
    setEditSaving(true);
    // 單程 toggle：勾選時把 returnDate 設成 null（變單程）；否則保留原值
    const newReturnDate = editIsOneWay ? null : undefined;
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sub.id,
          sourceId: subSourceId,
          maxPrice: newPrice,
          maxPriceTraditional: newTradPrice,                    // null = 跟隨主目標
          outboundMinDepartureTime: newOutMin,                   // null = 不過濾
          returnMinDepartureTime: newRetMin,
          outboundMaxDepartureTime: newOutMax,
          returnMaxDepartureTime: newRetMax,
          ...(newReturnDate === null && { returnDate: null })   // 只有單程才送 returnDate=null
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
              outbound_min_departure_time: newOutMin,
              return_min_departure_time: newRetMin,
              outbound_max_departure_time: newOutMax,
              return_max_departure_time: newRetMax,
              ...(editIsOneWay && { return_date: null })
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
            icon={<Icon name="takeoff" size={56} />}
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

                          {(sub.outbound_min_departure_time || sub.outbound_max_departure_time
                            || sub.return_min_departure_time || sub.return_max_departure_time) && (
                            <div className="card-timefilter">
                              <span className="card-timefilter-icon">⏰</span>
                              <span>
                                起飛時段　去 {formatWindow(sub.outbound_min_departure_time, sub.outbound_max_departure_time)}
                                {' · '}
                                回 {formatWindow(sub.return_min_departure_time, sub.return_max_departure_time)}
                              </span>
                            </div>
                          )}

                          {sub.label && (
                            <div className="card-note"><Icon name="pencil" size={14} /> {sub.label}</div>
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
                  <Icon name="airplane" size={14} /> {editingSub.origin} → {editingSub.destination}
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
                    checked={editIsOneWay}
                    onChange={e => setEditIsOneWay(e.target.checked)}
                  />
                  <span>單程訂閱（不追蹤回程）</span>
                </label>

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
                  <span>限制起飛時段</span>
                </label>

                {editTimeFilterEnabled && (
                  <>
                    <div className="edit-time-section">
                      <div className="edit-time-section-title">去程</div>
                      <div className="edit-time-section-hint">每格空白 = 該端不限</div>
                      <div className="edit-time-row">
                        <div className="edit-time-cell">
                          <label htmlFor="edit-out-min">不早於</label>
                          <input
                            id="edit-out-min"
                            type="time"
                            value={editOutboundMinTime}
                            onChange={e => setEditOutboundMinTime(e.target.value)}
                          />
                        </div>
                        <div className="edit-time-cell">
                          <label htmlFor="edit-out-max">不晚於</label>
                          <input
                            id="edit-out-max"
                            type="time"
                            value={editOutboundMaxTime}
                            onChange={e => setEditOutboundMaxTime(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="edit-time-section">
                      <div className="edit-time-section-title">回程</div>
                      <div className="edit-time-row">
                        <div className="edit-time-cell">
                          <label htmlFor="edit-ret-min">不早於</label>
                          <input
                            id="edit-ret-min"
                            type="time"
                            value={editReturnMinTime}
                            onChange={e => setEditReturnMinTime(e.target.value)}
                          />
                        </div>
                        <div className="edit-time-cell">
                          <label htmlFor="edit-ret-max">不晚於</label>
                          <input
                            id="edit-ret-max"
                            type="time"
                            value={editReturnMaxTime}
                            onChange={e => setEditReturnMaxTime(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </>
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

        {/*
          Design tokens 已移到 src/app/liff/_styles/tokens.css，由 LIFF layout
          自動 import。Body 樣式 (背景 / 字型) 由本檔 .subs-wrap 自己負責
          (該 class 已設 background: var(--ios-bg) + font-family)，不再
          污染 global body — 避免影響其他 light theme LIFF 頁面。
        */}
        <style jsx>{`
          .subs-wrap {
            max-width: 640px;
            margin: 0 auto;
            padding: 24px 16px 96px;
            background: var(--ios-bg);
            min-height: 100vh;
            font-family: var(--font);
            color: var(--ios-label);
            -webkit-font-smoothing: antialiased;
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
          .edit-time-section {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 12px;
            background: rgba(100, 210, 255, 0.06);
            border-radius: 10px;
            border: 0.5px solid rgba(100, 210, 255, 0.15);
          }
          .edit-time-section-title {
            font-size: 13px;
            font-weight: 600;
            color: #64d2ff;
            letter-spacing: 0.5px;
          }
          .edit-time-section-hint {
            font-size: 11px;
            color: rgba(235, 235, 245, 0.45);
            letter-spacing: -0.06px;
            margin-bottom: 4px;
          }
          .edit-time-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }
          .edit-time-cell {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .edit-time-cell label {
            font-size: 12px;
            font-weight: 500;
            color: rgba(235, 235, 245, 0.7);
            letter-spacing: -0.06px;
          }
          .edit-time-cell input[type="time"] {
            background: rgba(120, 120, 128, 0.24);
            border: none;
            border-radius: 8px;
            padding: 10px 12px;
            color: #ffffff;
            font-size: 16px;
            font-weight: 500;
            font-feature-settings: 'tnum' 1;
            outline: none;
            transition: background 0.15s ease;
            font-family: inherit;
            min-width: 0;
            width: 100%;
            box-sizing: border-box;
          }
          .edit-time-cell input[type="time"]:focus {
            background: rgba(120, 120, 128, 0.36);
          }
          .edit-time-cell input[type="time"]::-webkit-calendar-picker-indicator {
            filter: invert(1) brightness(0.85);
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
