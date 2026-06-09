/**
 * WatchDetailSheet — render coverage + edit save + delete + degradation
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { WatchDetailSheet } from '../WatchDetailSheet';
import type { WatchItem } from '../../_hooks/useWatchlist';

const baseWatch: WatchItem = {
  id: 7,
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
  quote: {
    currentBest: 11480,
    currentType: 'lcc',
    lcc: { price: 11480, out: '酷航', ret: '捷星', estimate: true },
    trad: { price: 18650, airline: '星宇航空' },
    deltaPct: -6.2,
    history: Array.from({ length: 30 }, (_, i) => ({ d: `5/${i + 1}`, p: 15000 - i * 100 }))
  }
};

describe('WatchDetailSheet', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('watch=null 時 → 仍 render 空 sheet（不 crash）', () => {
    const { container } = render(
      <WatchDetailSheet open={false} onClose={() => {}} watch={null} />
    );
    expect(container.querySelector('[data-testid="bottom-sheet"]')).toBeInTheDocument();
  });

  it('open + watch 有值 → 顯示 hero / chart / cat-cards / settings', () => {
    const { container, getByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={baseWatch} />
    );
    // 主價格
    expect(container.textContent).toContain('11,480');
    // chart 存在
    expect(getByTestId('price-chart')).toBeInTheDocument();
    // 兩張 cat-card
    expect(container.textContent).toContain('廉航');
    expect(container.textContent).toContain('傳統');
    expect(container.textContent).toContain('星宇航空');
    // 設定 block
    expect(container.textContent).toContain('追蹤設定');
  });

  it('quote=null → hero 用目標價 + 不畫 chart + 不顯示 cat-cards', () => {
    const w: WatchItem = { ...baseWatch, quote: null };
    const { container, queryByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={w} />
    );
    // 沒 chart
    expect(queryByTestId('price-chart')).toBeNull();
    // hero 用 max_price (12,800) 顯示
    expect(container.textContent).toContain('12,800');
  });

  it('儲存按鈕 → PATCH /api/subscriptions + onMutated', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true })
    });
    const onMutated = jest.fn();
    const { getByText } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={baseWatch} onMutated={onMutated} />
    );
    fireEvent.click(getByText('儲存變更'));
    await waitFor(() => {
      const calls = (global.fetch as unknown as jest.Mock).mock.calls;
      const patchCall = calls.find(c => (c[1] as RequestInit)?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall![1].body);
      expect(body.id).toBe(7);
      expect(body.sourceId).toBe('Uabc');
      expect(body.maxPrice).toBe(12800);
      expect(body.paused).toBe(false);
    });
    expect(onMutated).toHaveBeenCalled();
  });

  it('刪除：第一次點 → 顯示確認 UI，再點確認才真刪', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true })
    });
    const onMutated = jest.fn();
    const onClose = jest.fn();
    const { getByText, container } = render(
      <WatchDetailSheet open={true} onClose={onClose} watch={baseWatch} onMutated={onMutated} />
    );
    fireEvent.click(getByText('刪除此追蹤'));
    // 進入 confirm 狀態
    expect(container.textContent).toContain('確定刪除');
    // 一定要看到「確認刪除」按鈕
    fireEvent.click(getByText('確認刪除'));
    await waitFor(() => {
      const calls = (global.fetch as unknown as jest.Mock).mock.calls;
      const delCall = calls.find(c => (c[1] as RequestInit)?.method === 'DELETE');
      expect(delCall).toBeDefined();
      expect(delCall![0]).toContain('id=7');
      expect(delCall![0]).toContain('sourceId=Uabc');
    });
    expect(onMutated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('傳統航空 toggle → 開啟後顯示傳統目標價輸入', () => {
    const { container, getByLabelText, getByText } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={baseWatch} />
    );
    expect(container.textContent).not.toContain('傳統航空目標價');
    fireEvent.click(getByLabelText('傳統航空另設'));
    // 開啟後出現「傳統航空目標價」
    expect(getByText('傳統航空目標價')).toBeInTheDocument();
  });

  it('暫停 toggle → 改變 PATCH body 的 paused', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true })
    });
    const { getByText, getByLabelText } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={baseWatch} />
    );
    fireEvent.click(getByLabelText('暫停追蹤'));
    fireEvent.click(getByText('儲存變更'));
    await waitFor(() => {
      const patchCall = (global.fetch as unknown as jest.Mock).mock.calls.find(
        c => (c[1] as RequestInit)?.method === 'PATCH'
      );
      const body = JSON.parse(patchCall![1].body);
      expect(body.paused).toBe(true);
    });
  });
});
