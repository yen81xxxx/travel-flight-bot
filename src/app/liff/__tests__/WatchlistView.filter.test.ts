/**
 * computeFilterCounts + applyFilter — 純函數測試
 *
 * 抓兩件事：
 *   1. counts 算對：filter chip 顯示的數字不能假
 *   2. filter 排除規則對：「已達標」要扣掉 paused、quote=null 的
 *
 * 這層是 watchlist 的核心商業邏輯，比 UI render 重要。
 */
import { computeFilterCounts, applyFilter } from '../WatchlistView';
import type { WatchItem } from '../_hooks/useWatchlist';

const mk = (overrides: Partial<WatchItem>): WatchItem => ({
  id: 1,
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
  _source: 'personal',
  quote: null,
  ...overrides
});

// helpers — currentBest < target → signal=hit；等於 target 也算
const hit = (id: number, source: 'personal' | 'group' = 'personal') =>
  mk({ id, _source: source, max_price: 12800, quote: { currentBest: 11000, currentType: 'lcc', lcc: null, trad: null, deltaPct: null, history: [] } });
const watching = (id: number, source: 'personal' | 'group' = 'personal') =>
  mk({ id, _source: source, max_price: 12800, quote: { currentBest: 20000, currentType: 'lcc', lcc: null, trad: null, deltaPct: null, history: [] } });
const noQuote = (id: number, source: 'personal' | 'group' = 'personal') =>
  mk({ id, _source: source, quote: null });

describe('computeFilterCounts', () => {
  it('空 list → 全部 0', () => {
    expect(computeFilterCounts([])).toEqual({ all: 0, hit: 0, personal: 0, group: 0 });
  });

  it('1 hit personal + 1 watching personal → all=2, hit=1, personal=2', () => {
    expect(computeFilterCounts([hit(1), watching(2)])).toEqual({
      all: 2, hit: 1, personal: 2, group: 0
    });
  });

  it('paused hit → 不算進 hit 數', () => {
    expect(computeFilterCounts([
      mk({ id: 1, paused: true, max_price: 12800, quote: { currentBest: 11000, currentType: 'lcc', lcc: null, trad: null, deltaPct: null, history: [] } })
    ])).toEqual({ all: 1, hit: 0, personal: 1, group: 0 });
  });

  it('quote=null → 不算進 hit 數（即使 max_price 看起來會 hit）', () => {
    expect(computeFilterCounts([noQuote(1)])).toEqual({
      all: 1, hit: 0, personal: 1, group: 0
    });
  });

  it('混合 personal + group + hits → 每欄都正確', () => {
    const watches = [
      hit(1, 'personal'),
      watching(2, 'personal'),
      hit(3, 'group'),
      noQuote(4, 'group')
    ];
    expect(computeFilterCounts(watches)).toEqual({
      all: 4, hit: 2, personal: 2, group: 2
    });
  });
});

describe('applyFilter', () => {
  const watches: WatchItem[] = [
    hit(1, 'personal'),
    watching(2, 'personal'),
    hit(3, 'group'),
    noQuote(4, 'group'),
    mk({
      id: 5,
      _source: 'group',
      paused: true,
      max_price: 12800,
      quote: { currentBest: 11000, currentType: 'lcc', lcc: null, trad: null, deltaPct: null, history: [] }
    })
  ];

  it('all → 全部回傳', () => {
    expect(applyFilter(watches, 'all').map(w => w.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('hit → 排除 paused + quote=null + signal!=hit', () => {
    // 1 = personal hit, 3 = group hit, 5 = paused hit（排除）
    expect(applyFilter(watches, 'hit').map(w => w.id).sort()).toEqual([1, 3]);
  });

  it('personal → 只回 _source=personal', () => {
    expect(applyFilter(watches, 'personal').map(w => w.id)).toEqual([1, 2]);
  });

  it('group → 只回 _source=group（含 paused）', () => {
    expect(applyFilter(watches, 'group').map(w => w.id).sort()).toEqual([3, 4, 5]);
  });
});
