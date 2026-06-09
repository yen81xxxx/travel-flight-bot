/**
 * useWatchlist — mergeWatches 純函數測試
 *
 * 不測 hook 本身的 fetch / useState lifecycle —那會需要 mock fetch + RTL render hook，
 * 額外複雜度高（且現實是 fetch 的測試在 quote-builder route.test 已經覆蓋）。
 * 這裡只測「合併多 source 的策略」是否正確：
 *   - 個人優先（同 id 既在個人又在群組 → 標 personal）
 *   - dedup by id
 *   - id == null 不算進來（防舊資料污染）
 *   - 排序穩定（個人在群組之前？實際上 hook 已經把 sourceId 順序固定，這裡只測 merge）
 */
import { mergeWatches } from '../useWatchlist';
import type { WatchWithQuote } from '../../_types';

const mkWatch = (id: number, overrides: Partial<WatchWithQuote> = {}): WatchWithQuote => ({
  id,
  source_id: 'Uabc',
  source_type: 'user',
  origin: 'TPE',
  destination: 'NRT',
  outbound_date: '2026-08-14',
  return_date: '2026-08-18',
  max_price: 12800,
  max_price_traditional: null,
  active: true,
  paused: false,
  label: null,
  outbound_min_departure_time: null,
  outbound_max_departure_time: null,
  return_min_departure_time: null,
  return_max_departure_time: null,
  quote: null,
  ...overrides
});

describe('mergeWatches', () => {
  it('空輸入 → 空陣列', () => {
    expect(mergeWatches([])).toEqual([]);
  });

  it('純個人 → 全部標 _source=personal', () => {
    const merged = mergeWatches([{
      type: 'personal',
      watches: [mkWatch(1), mkWatch(2)]
    }]);
    expect(merged).toHaveLength(2);
    expect(merged.every(w => w._source === 'personal')).toBe(true);
  });

  it('純群組 → 全部標 _source=group', () => {
    const merged = mergeWatches([{
      type: 'group',
      watches: [mkWatch(1)]
    }]);
    expect(merged[0]._source).toBe('group');
  });

  it('個人 + 群組（無重複 id）→ 全部保留，各自標', () => {
    const merged = mergeWatches([
      { type: 'personal', watches: [mkWatch(1), mkWatch(2)] },
      { type: 'group', watches: [mkWatch(3)] }
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.find(w => w.id === 1)?._source).toBe('personal');
    expect(merged.find(w => w.id === 3)?._source).toBe('group');
  });

  it('同 id 在個人 + 群組都有 → 標 personal 優先', () => {
    const merged = mergeWatches([
      { type: 'group', watches: [mkWatch(1)] },
      { type: 'personal', watches: [mkWatch(1)] }
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]._source).toBe('personal');
  });

  it('id == null 的 row 不算（防舊資料）', () => {
    const merged = mergeWatches([{
      type: 'personal',
      // @ts-expect-error 故意餵壞資料
      watches: [{ ...mkWatch(1), id: null }, mkWatch(2)]
    }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(2);
  });

  it('多個群組來源都合進來，個別 dedup', () => {
    const merged = mergeWatches([
      { type: 'group', watches: [mkWatch(10), mkWatch(11)] },
      { type: 'group', watches: [mkWatch(11), mkWatch(12)] } // 11 重複
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.map(w => w.id).sort()).toEqual([10, 11, 12]);
  });
});
