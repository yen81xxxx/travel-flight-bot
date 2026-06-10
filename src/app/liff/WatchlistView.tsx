'use client';

/**
 * WatchlistView — /liff 主入口主畫面（PR #3）。
 *
 * 對應 design_handoff_travl_vision §4.1 的 Watchlist Home：
 *   - Header: eyebrow + 大標 + 右上角 gear（→ SettingsSheet，PR #4 接；目前先連 /liff/settings）
 *   - DigestHero（條件：filter=all + 至少 1 個 hit watch）
 *   - Filter chips: 全部 / 已達標 / 個人 / 群組（各帶 count）
 *   - WatchCard 列表（filter 後）
 *   - FAB「＋ 新增追蹤」（→ AddWatchSheet，PR #4 接；目前先連 /liff/search）
 *
 * 暫時的「連舊頁面」連結：FAB / gear / WatchCard onOpen 三處在 PR #4 才會
 * 改成開 sheet。這 PR 先讓使用者「看得到新 watchlist 但能操作不會壞」。
 */
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useLiff } from '@/hooks/useLiff';
import { useKnownGroupCtxs } from '@/hooks/useKnownGroupCtxs';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { Spinner } from '@/components';
import { useWatchlist, type WatchItem } from './_hooks/useWatchlist';
import { deriveSignal } from './_lib/signal';
import { WatchCard } from './_components/WatchCard';
import { DigestHero, pickDigestWatch } from './_components/DigestHero';
import { Icon } from './_components/Icon';
import { WatchDetailSheet } from './_components/WatchDetailSheet';
import { AddWatchSheet } from './_components/AddWatchSheet';
import { SettingsSheet } from './_components/SettingsSheet';

interface Props {
  liffId: string;
}

export type FilterKey = 'all' | 'hit' | 'personal' | 'group';

/** 對給定 watch list 算 filter chip 的 count map — 抽純函數方便單測 */
export function computeFilterCounts(watches: WatchItem[]): Record<FilterKey, number> {
  let hit = 0;
  let personal = 0;
  let group = 0;
  for (const w of watches) {
    if (w._source === 'personal') personal++;
    else group++;
    if (!w.paused && w.quote && deriveSignal(w.quote.currentBest, Number(w.max_price)) === 'hit') hit++;
  }
  return { all: watches.length, hit, personal, group };
}

/** 套 filter — 純函數方便單測 */
export function applyFilter(watches: WatchItem[], filter: FilterKey): WatchItem[] {
  if (filter === 'all') return watches;
  if (filter === 'hit') {
    return watches.filter(w =>
      !w.paused && w.quote && deriveSignal(w.quote.currentBest, Number(w.max_price)) === 'hit'
    );
  }
  if (filter === 'personal') return watches.filter(w => w._source === 'personal');
  if (filter === 'group') return watches.filter(w => w._source === 'group');
  return watches;
}

export default function WatchlistView({ liffId }: Props) {
  const { liffReady, user } = useLiff(liffId);
  const sourceId = user?.userId ?? null;

  // 群組 ctx 處理 — 跟既有 SubscriptionsViewV2 同模式（URL ?ctx= → sessionStorage + localStorage）
  const [groupCtxId, setGroupCtxId] = useSessionStorage<string | null>('liff_ctx', null);
  const { ctxs: knownGroupCtxs, add: addKnownGroupCtx } = useKnownGroupCtxs();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get('ctx');
    if (ctx && (ctx.startsWith('C') || ctx.startsWith('R'))) {
      setGroupCtxId(ctx);
      addKnownGroupCtx(ctx);
    }
  }, [setGroupCtxId, addKnownGroupCtx]);

  const { watches, loading, error, refetch } = useWatchlist(sourceId, knownGroupCtxs);

  const [filter, setFilter] = useState<FilterKey>('all');

  // === Sheet routing state ===
  // 一次只開一個 sheet — 用 single field 控制（避免兩個同時開的狀態組合）
  const [sheet, setSheet] = useState<
    | { kind: 'none' }
    | { kind: 'detail'; watch: WatchItem }
    | { kind: 'add' }
    | { kind: 'settings' }
  >({ kind: 'none' });
  const closeSheet = () => setSheet({ kind: 'none' });

  const counts = useMemo(() => computeFilterCounts(watches), [watches]);
  const filtered = useMemo(() => applyFilter(watches, filter), [watches, filter]);

  // DigestHero 只在 filter=all 時顯示；pickDigestWatch 內部做 hit 過濾
  const digestWatch = filter === 'all' ? pickDigestWatch(watches) : null;
  // PR #5 de-dup rule (設計手冊 §4.1)：被選為 digest 的那筆從下方 list 排除，
  // 避免同一條路線/價格在主畫面同時出現兩次。
  // 該 watch 仍可在「已達標」filter 看到 — 那個 tab 不會顯示 digest hero。
  const listedWatches = digestWatch
    ? filtered.filter(w => w.id !== digestWatch.id)
    : filtered;

  // === Sheet handlers ===（PR #4a 完整接上、PR #4b 加 notify-target）
  // 全部走 sheet state，不再 navigate 出去。舊三條路由 (search/subscriptions/settings)
  // PR #4b 改成 redirect /liff，本檔不再連結它們。
  const goToSettings = () => setSheet({ kind: 'settings' });
  const goToAdd = () => setSheet({ kind: 'add' });
  const openWatch = (w: WatchItem) => setSheet({ kind: 'detail', watch: w });
  // SettingsSheet 改個人設定，sourceId 用個人 (個人 + 群組同時打開的情境，群組設定本不該被覆寫)
  const settingsSourceId = sourceId;

  // === 載入 default_notify_target setting（給 AddWatchSheet 預填）===
  const [defaultNotifyTarget, setDefaultNotifyTarget] = useState<'me' | 'group'>('me');
  useEffect(() => {
    if (!sourceId) return;
    fetch(`/api/notification-settings?sourceId=${encodeURIComponent(sourceId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.settings?.default_notify_target === 'group') {
          setDefaultNotifyTarget('group');
        }
      })
      .catch(() => { /* 預設 'me' 即可 */ });
  }, [sourceId]);

  // 還沒 LIFF ready → spinner（不要 flash 空 list）
  if (liffId && !liffReady) {
    return (
      <div className="loading-wrap">
        <Spinner />
        <style jsx>{`
          .loading-wrap {
            min-height: 100vh;
            background: var(--ios-bg);
            display: flex;
            align-items: center;
            justify-content: center;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="wl-wrap">
      {/* ---- Header ---- */}
      <header className="wl-head">
        <div>
          <div className="eyebrow">FLIGHT TRACKER</div>
          <h1 className="page-title">追蹤清單<span className="dot-blue">.</span></h1>
        </div>
        <button className="icon-btn" type="button" onClick={goToSettings} aria-label="設定">
          <Icon name="gear" size={20} stroke={1.9} />
        </button>
      </header>

      {/* ---- DigestHero（條件秀） ---- */}
      {digestWatch && <DigestHero watch={digestWatch} onOpen={openWatch} />}

      {/* ---- Filter chips ---- */}
      <div className="filters" role="tablist" aria-label="篩選">
        {(['all', 'hit', 'personal', 'group'] as FilterKey[]).map(k => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={filter === k}
            className={`chip ${filter === k ? 'active' : ''}`}
            onClick={() => setFilter(k)}
            data-testid={`filter-chip-${k}`}
          >
            {{ all: '全部', hit: '已達標', personal: '個人', group: '群組' }[k]}
            <span className="chip-count tnum">{counts[k]}</span>
          </button>
        ))}
      </div>

      {/* ---- Watch list ---- */}
      {error && <div className="error-banner">{error}</div>}

      {loading && watches.length === 0 ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <Icon name="bookmark" size={42} style={{ color: 'var(--ios-label-3)' }} />
          <div className="empty-title">
            {watches.length === 0 ? '還沒有追蹤' : '沒有符合的追蹤'}
          </div>
          <div className="empty-hint">
            {watches.length === 0
              ? '按下方「＋ 新增追蹤」開始監控航班降價'
              : '試試切換上方篩選'}
          </div>
        </div>
      ) : (
        <div className="watch-list">
          {/* PR #5: digest 顯示時，下方 list 加「其他追蹤 · N」section header — 視覺分開 hero 跟一般項 */}
          {digestWatch && listedWatches.length > 0 && (
            <div className="list-section-label tnum">其他追蹤 · {listedWatches.length}</div>
          )}
          {listedWatches.map(w => (
            <WatchCard key={w.id} watch={w} onOpen={openWatch} />
          ))}
          {/* digest 把唯一的 watch 吃掉時：list 就空 — 仍顯示提示但不再 redundant 列 */}
          {digestWatch && listedWatches.length === 0 && (
            <div className="list-section-label">就是上面那條，沒別的追蹤</div>
          )}
        </div>
      )}

      {/* ---- FAB ---- */}
      <button className="fab pressable" type="button" onClick={goToAdd} aria-label="新增追蹤">
        <Icon name="plus" size={18} stroke={2.4} />
        <span>新增追蹤</span>
      </button>

      {/* ---- Sheets ---- */}
      <WatchDetailSheet
        open={sheet.kind === 'detail'}
        onClose={closeSheet}
        watch={sheet.kind === 'detail' ? sheet.watch : null}
        userId={sourceId}
        onMutated={refetch}
      />
      <AddWatchSheet
        open={sheet.kind === 'add'}
        onClose={closeSheet}
        userId={sourceId}
        groupCtxId={groupCtxId}
        defaultNotifyTarget={defaultNotifyTarget}
        onCreated={refetch}
      />
      <SettingsSheet
        open={sheet.kind === 'settings'}
        onClose={closeSheet}
        sourceId={settingsSourceId}
      />

      <style jsx>{`
        .wl-wrap {
          max-width: 640px;
          margin: 0 auto;
          padding: 18px 16px 110px;
          min-height: 100vh;
          background: var(--ios-bg);
          color: var(--ios-label);
          font-family: var(--font);
          -webkit-font-smoothing: antialiased;
        }
        .wl-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          padding: 6px 4px 0;
          margin-bottom: 18px;
        }
        .eyebrow {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1.6px;
          color: var(--ios-blue);
          text-transform: uppercase;
          margin-bottom: 5px;
        }
        .page-title {
          font-size: 30px;
          font-weight: 700;
          margin: 0;
          color: var(--ios-label);
          letter-spacing: -0.5px;
          line-height: 1.08;
        }
        .dot-blue { color: var(--ios-blue); }
        .icon-btn {
          appearance: none;
          background: var(--ios-fill-2);
          border: none;
          color: var(--ios-label);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .filters {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 4px 2px 14px;
          -webkit-overflow-scrolling: touch;
        }
        .filters::-webkit-scrollbar { display: none; }
        .chip {
          appearance: none;
          border: 0.5px solid var(--ios-hairline);
          background: var(--ios-fill-2);
          color: var(--ios-label-2);
          font-size: 13px;
          font-weight: 600;
          padding: 7px 13px;
          border-radius: var(--r-pill);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          cursor: pointer;
        }
        .chip.active {
          background: var(--ios-label);
          color: var(--ios-bg);
          border-color: var(--ios-label);
        }
        .chip-count {
          font-weight: 500;
          opacity: 0.75;
          font-size: 11.5px;
        }

        .error-banner {
          background: rgba(255, 69, 58, 0.15);
          color: var(--ios-red);
          padding: 10px 14px;
          border-radius: var(--r-field);
          font-size: 13px;
          margin-bottom: 12px;
        }

        .empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 48px 16px;
          text-align: center;
        }
        .empty-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--ios-label-2);
        }
        .empty-hint {
          font-size: 12.5px;
          color: var(--ios-label-3);
        }
        .list-section-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--ios-label-3);
          letter-spacing: 1.4px;
          text-transform: uppercase;
          margin: 8px 4px 10px;
        }

        .fab {
          position: fixed;
          bottom: 18px;
          right: 18px;
          background: var(--ios-blue);
          color: #fff;
          border: none;
          border-radius: var(--r-pill);
          padding: 13px 18px;
          font-size: 14px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 6px 24px rgba(10, 132, 255, 0.42);
          cursor: pointer;
          z-index: 50;
        }
      `}</style>
    </div>
  );
}
