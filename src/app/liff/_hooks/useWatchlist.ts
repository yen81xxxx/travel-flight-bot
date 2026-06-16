/**
 * useWatchlist — 撈個人 + 所有已知群組訂閱（含 quote），合併去重
 *
 * 對既有 SubscriptionsViewV2 的合併邏輯（個人 + knownGroupCtxs）做了 quote-aware
 * 版本，打 /api/subscriptions/with-quotes 而不是 /api/subscriptions。
 *
 * 為什麼抽 hook：
 *   - WatchlistView 要 filter / DigestHero 要算 hit count，多 component 共用同一份 watches
 *   - 之後 PR #4 sheets 也要存取（detail sheet 要 watch by id）
 *   - 純函數 mergeWatches 抽出來方便單測（filter 邏輯就只是純邏輯）
 *
 * sourceId+groupCtxs 任一變動 → 重新 fetch。Fetch 失敗對應 source 直接吞掉、
 * 不讓整支變 error 狀態（一個群組失效不該擋住個人訂閱顯示）。
 */
import { useCallback, useEffect, useState } from 'react';
import type { WatchWithQuote } from '../_types';

/** 多了 _source 標記 — 跟既有 SubscriptionsViewV2 的 ItemWithSource 同模式 */
export interface WatchItem extends WatchWithQuote {
  _source: 'personal' | 'group';
}

/** 合併多個 source 撈來的 watches，個人優先（dedup by id） */
export function mergeWatches(
  groups: { type: 'personal' | 'group'; watches: WatchWithQuote[] }[]
): WatchItem[] {
  const merged: WatchItem[] = [];
  const seen = new Set<number>();
  // 個人優先 — 同一筆訂閱在個人 + 群組都看得到時，標 _source='personal'
  // 用 stable partition：個人先、群組後（排序不依賴 b，省 lint unused 警告）
  const sorted = [
    ...groups.filter(g => g.type === 'personal'),
    ...groups.filter(g => g.type === 'group')
  ];
  for (const g of sorted) {
    for (const w of g.watches) {
      if (w.id == null || seen.has(w.id)) continue;
      seen.add(w.id);
      merged.push({ ...w, _source: g.type });
    }
  }
  return merged;
}

interface UseWatchlistResult {
  watches: WatchItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** 樂觀移除一筆（刪除成功後立刻從畫面拿掉，不等 refetch — 解決「刪了卡片還在」） */
  removeWatch: (id: number) => void;
}

export function useWatchlist(
  personalSourceId: string | null,
  knownGroupCtxs: string[]
): UseWatchlistResult {
  const [watches, setWatches] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refetch = useCallback(() => setReloadKey(k => k + 1), []);
  const removeWatch = useCallback((id: number) => {
    setWatches(ws => ws.filter(w => w.id !== id));
  }, []);

  useEffect(() => {
    const targets: { sourceId: string; type: 'personal' | 'group' }[] = [];
    if (personalSourceId) targets.push({ sourceId: personalSourceId, type: 'personal' });
    for (const c of knownGroupCtxs) targets.push({ sourceId: c, type: 'group' });

    if (targets.length === 0) {
      setWatches([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    Promise.all(
      targets.map(t =>
        // no-store：刪除/編輯後 refetch 必須拿到新資料，不能吃瀏覽器 GET 快取
        // （否則剛刪掉的訂閱還會被舊快取帶回來、卡片重新出現）
        fetch(`/api/subscriptions/with-quotes?sourceId=${encodeURIComponent(t.sourceId)}`, { cache: 'no-store' })
          .then(r => r.json())
          .then((data: { ok: boolean; watches?: WatchWithQuote[] }) => ({
            type: t.type,
            watches: data.ok && Array.isArray(data.watches) ? data.watches : []
          }))
          // 單一 source fetch 失敗 → 該 source 算空，不污染其他 source
          .catch(() => ({ type: t.type, watches: [] as WatchWithQuote[] }))
      )
    )
      .then(groups => setWatches(mergeWatches(groups)))
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [personalSourceId, knownGroupCtxs, reloadKey]);

  return { watches, loading, error, refetch, removeWatch };
}
