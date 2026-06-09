/**
 * DigestHero — pickDigestWatch + render
 *
 * Pick 規則（純函數）：
 *   - 必須非 paused
 *   - 必須有 quote
 *   - signal === 'hit'
 *   - 多個達標 → 挑 currentBest 最低
 *
 * 沒符合的 watch → 不 render（return null）
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { DigestHero, pickDigestWatch } from '../DigestHero';
import type { WatchItem } from '../../_hooks/useWatchlist';

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

const mkHit = (id: number, currentBest: number) => mk({
  id,
  max_price: 12800,
  quote: { currentBest, currentType: 'lcc', lcc: null, trad: null, deltaPct: -5, history: [] }
});

describe('pickDigestWatch', () => {
  it('空 list → null', () => {
    expect(pickDigestWatch([])).toBeNull();
  });

  it('沒有 hit 的訂閱 → null', () => {
    const watching = mk({ id: 1, max_price: 12800, quote: { currentBest: 20000, currentType: 'lcc', lcc: null, trad: null, deltaPct: null, history: [] } });
    expect(pickDigestWatch([watching])).toBeNull();
  });

  it('quote=null 的訂閱 → 不算進來', () => {
    expect(pickDigestWatch([mk({ id: 1, quote: null })])).toBeNull();
  });

  it('paused hit → 不算（排除暫停的）', () => {
    const paused = mk({
      id: 1, paused: true, max_price: 12800,
      quote: { currentBest: 11000, currentType: 'lcc', lcc: null, trad: null, deltaPct: null, history: [] }
    });
    expect(pickDigestWatch([paused])).toBeNull();
  });

  it('1 個 hit → 回傳該筆', () => {
    const w = mkHit(1, 11000);
    expect(pickDigestWatch([w])).toBe(w);
  });

  it('多個 hit → 挑 currentBest 最低', () => {
    const w1 = mkHit(1, 11500);
    const w2 = mkHit(2, 11000); // 最便宜
    const w3 = mkHit(3, 11200);
    expect(pickDigestWatch([w1, w2, w3])).toBe(w2);
  });

  it('混合 hit + watching → 挑 hit 內最便宜', () => {
    const hit1 = mkHit(1, 11000);
    const watching1 = mk({ id: 2, max_price: 12800, quote: { currentBest: 5000, currentType: 'lcc', lcc: null, trad: null, deltaPct: null, history: [] } });
    // watching1 currentBest 雖然最低，但它本來就 < target，signal=hit 才會被挑
    // 5000 < target 12800 → 也是 hit！所以 watching1 其實會被算 hit
    const result = pickDigestWatch([hit1, watching1]);
    expect(result).toBe(watching1); // 5000 < 11000
  });
});

describe('DigestHero — render', () => {
  it('render 路由 / 訊息 / 價格', () => {
    const w = mkHit(1, 11000);
    const { getByTestId, container } = render(<DigestHero watch={w} onOpen={() => {}} />);
    expect(getByTestId('digest-hero')).toBeInTheDocument();
    expect(container.textContent).toContain('TPE→NRT');
    expect(container.textContent).toContain('11,000');
    expect(container.textContent).toContain('已跌破你的目標價');
    expect(container.textContent).toContain('12,800'); // 目標
  });

  it('quote=null → return null（caller 沒過濾的 fallback）', () => {
    const w = mk({ id: 1, quote: null });
    const { container } = render(<DigestHero watch={w} onOpen={() => {}} />);
    expect(container.querySelector('[data-testid="digest-hero"]')).toBeNull();
  });

  it('onOpen 被點到時帶 watch 物件', () => {
    const w = mkHit(1, 11000);
    const onOpen = jest.fn();
    const { getByTestId } = render(<DigestHero watch={w} onOpen={onOpen} />);
    fireEvent.click(getByTestId('digest-hero'));
    expect(onOpen).toHaveBeenCalledWith(w);
  });

  it('deltaPct=null → 不顯示 "比上週 X%" 句', () => {
    const w = mk({
      id: 1, max_price: 12800,
      quote: { currentBest: 11000, currentType: 'lcc', lcc: null, trad: null, deltaPct: null, history: [] }
    });
    const { container } = render(<DigestHero watch={w} onOpen={() => {}} />);
    expect(container.textContent).not.toContain('比上週');
  });
});
