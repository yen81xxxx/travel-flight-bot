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
  // URL-discriminating mock：flights GET / PATCH / DELETE 各自路由。
  // 個別 test 用 mockImplementationOnce 覆寫該情境的 PATCH/DELETE 回應。
  beforeEach(() => {
    global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      // flights GET 預設回空 list
      if (u.includes('/api/subscriptions/flights')) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, outbound: [], return: [] })
        } as Response);
      }
      // PATCH / DELETE — 預設 ok
      if (init?.method === 'PATCH' || init?.method === 'DELETE') {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true })
        } as Response);
      }
      return Promise.resolve({
        json: () => Promise.resolve({ ok: true })
      } as Response);
    }) as unknown as typeof fetch;
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

describe('WatchDetailSheet — G1 group join/leave', () => {
  beforeEach(() => {
    // Setup fetch mock that handles all 3 endpoints: flights, group GET, group POST
    global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/api/subscriptions/flights')) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, outbound: [], return: [] })
        } as Response);
      }
      if (u.includes('/api/group-watch/') && !init?.method) {
        // GET members — default empty
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, members: [] })
        } as Response);
      }
      if (u.includes('/api/group-watch/') && init?.method === 'POST') {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, action: 'joined' })
        } as Response);
      }
      return Promise.resolve({
        json: () => Promise.resolve({ ok: true })
      } as Response);
    }) as unknown as typeof fetch;
  });

  it('個人訂閱 → 不顯示 group block', () => {
    const personalWatch: WatchItem = { ...baseWatch, source_type: 'user', _source: 'personal' };
    const { queryByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={personalWatch} userId="Uabc" />
    );
    expect(queryByTestId('group-block')).toBeNull();
  });

  it('群組訂閱 + user 不是 member → 顯示「+ 我也要追」按鈕', async () => {
    const groupWatch: WatchItem = { ...baseWatch, source_type: 'group', _source: 'group' };
    const { findByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={groupWatch} userId="Uabc" />
    );
    await findByTestId('group-block');
    expect(await findByTestId('join-button')).toBeInTheDocument();
  });

  it('群組訂閱 + 點 join → POST 帶 action=join + userId + onMutated 觸發', async () => {
    const groupWatch: WatchItem = { ...baseWatch, source_type: 'group', _source: 'group' };
    const onMutated = jest.fn();
    const { findByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={groupWatch} userId="Uabc" onMutated={onMutated} />
    );
    const btn = await findByTestId('join-button');
    fireEvent.click(btn);
    await waitFor(() => {
      const calls = (global.fetch as unknown as jest.Mock).mock.calls;
      const postCall = calls.find(c => (c[1] as RequestInit)?.method === 'POST' && c[0].toString().includes('/api/group-watch/'));
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.action).toBe('join');
      expect(body.userId).toBe('Uabc');
    });
    expect(onMutated).toHaveBeenCalled();
  });

  it('群組訂閱 + members 有 caller → 顯示「離開追蹤」按鈕', async () => {
    (global.fetch as unknown as jest.Mock).mockImplementation((url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/api/group-watch/')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            ok: true,
            members: [{ line_user_id: 'Uabc', display_name: 'Alice', accepted_target: null, joined_at: '2026-06-01' }]
          })
        } as Response);
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, outbound: [], return: [] }) } as Response);
    });
    const groupWatch: WatchItem = { ...baseWatch, source_type: 'group', _source: 'group' };
    const { findByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={groupWatch} userId="Uabc" />
    );
    expect(await findByTestId('leave-button')).toBeInTheDocument();
  });

  it('userId=null (沒登入) → 不顯示 join/leave 按鈕，但仍顯示 members 數', async () => {
    const groupWatch: WatchItem = { ...baseWatch, source_type: 'group', _source: 'group' };
    const { findByTestId, queryByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={groupWatch} userId={null} />
    );
    await findByTestId('group-block');
    expect(queryByTestId('join-button')).toBeNull();
    expect(queryByTestId('leave-button')).toBeNull();
  });
});

describe('WatchDetailSheet — G2 consensus target + my-target editor', () => {
  beforeEach(() => {
    // Mock fetch that returns 2 members with targets, derived = max
    global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/api/subscriptions/flights')) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, outbound: [], return: [] }) } as Response);
      }
      if (u.includes('/api/group-watch/') && !init?.method) {
        return Promise.resolve({
          json: () => Promise.resolve({
            ok: true,
            members: [
              { line_user_id: 'Uabc', display_name: 'Alice', accepted_target: 12000, joined_at: '2026-06-01' },
              { line_user_id: 'Uxyz', display_name: 'Bob',   accepted_target: 18000, joined_at: '2026-06-02' }
            ],
            consensusRule: 'max',
            derivedTarget: 18000
          })
        } as Response);
      }
      if (u.includes('/api/group-watch/') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        return Promise.resolve({
          json: () => Promise.resolve({
            ok: true,
            action: body.action === 'set-target' ? 'target-set' : 'joined',
            derivedTarget: 25000  // simulate derived recomputed after target change
          })
        } as Response);
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as Response);
    }) as unknown as typeof fetch;
  });

  it('群組訂閱載入後 → 顯示每個 member 的 target (全公開)', async () => {
    const groupWatch: WatchItem = { ...baseWatch, source_type: 'group', _source: 'group' };
    const { findByTestId, container } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={groupWatch} userId="Uabc" />
    );
    await findByTestId('member-list');
    expect(container.textContent).toContain('Alice');
    expect(container.textContent).toContain('Bob');
    expect(container.textContent).toContain('12,000');
    expect(container.textContent).toContain('18,000');
  });

  it('member 數 >= 2 → 顯示群組目標（取最大）', async () => {
    const groupWatch: WatchItem = { ...baseWatch, source_type: 'group', _source: 'group' };
    const { findByTestId, container } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={groupWatch} userId="Uabc" />
    );
    await findByTestId('derived-target');
    expect(container.textContent).toContain('群組目標 NT$18,000');
    expect(container.textContent).toContain('取最大');
  });

  it('member 點「編輯我的目標」→ 顯示 input + 預填當前值', async () => {
    const groupWatch: WatchItem = { ...baseWatch, source_type: 'group', _source: 'group' };
    const { findByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={groupWatch} userId="Uabc" />
    );
    const editBtn = await findByTestId('edit-my-target-button');
    fireEvent.click(editBtn);
    const editor = await findByTestId('my-target-editor');
    expect(editor).toBeInTheDocument();
    const input = await findByTestId('my-target-input') as HTMLInputElement;
    expect(input.value).toBe('12000');  // Alice 的當前 target
  });

  it('儲存我的新目標 → POST set-target + 樂觀更新 + onMutated', async () => {
    const onMutated = jest.fn();
    const groupWatch: WatchItem = { ...baseWatch, source_type: 'group', _source: 'group' };
    const { findByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={groupWatch} userId="Uabc" onMutated={onMutated} />
    );
    fireEvent.click(await findByTestId('edit-my-target-button'));
    const input = await findByTestId('my-target-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '25000' } });
    fireEvent.click(await findByTestId('save-my-target-button'));
    await waitFor(() => {
      const postCall = (global.fetch as unknown as jest.Mock).mock.calls.find(
        c => (c[1] as RequestInit)?.method === 'POST' &&
             JSON.parse((c[1] as RequestInit).body as string).action === 'set-target'
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.target).toBe(25000);
      expect(body.userId).toBe('Uabc');
    });
    expect(onMutated).toHaveBeenCalled();
  });

  it('非 member → 不顯示「編輯我的目標」按鈕', async () => {
    const groupWatch: WatchItem = { ...baseWatch, source_type: 'group', _source: 'group' };
    const { findByTestId, queryByTestId } = render(
      <WatchDetailSheet open={true} onClose={() => {}} watch={groupWatch} userId="Uzzz" />
    );
    await findByTestId('member-list');
    expect(queryByTestId('edit-my-target-button')).toBeNull();
  });
});
