/**
 * AddWatchSheet — sourceId null fallback + preview button 行為 + submit + 航司過濾
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { AddWatchSheet } from '../AddWatchSheet';

// URL-aware fetch mock：route-airlines 單獨處理（掛載時會打），
// search / subscriptions 各自從 responses 取（不靠 mockResolvedValueOnce 順序，
// 否則 route-airlines 的掛載呼叫會吃掉 once 佇列）。
let responses: { search: unknown; subscriptions: unknown; routeAirlines: unknown };
beforeEach(() => {
  responses = {
    search: { ok: true },
    subscriptions: { ok: true },
    routeAirlines: { ok: true, airlines: [] }  // 預設空 → 航司 UI 不出現（既有測試不受影響）
  };
  global.fetch = jest.fn((url: string | URL) => {
    const u = String(url);
    const body = u.includes('/api/route-airlines') ? responses.routeAirlines
      : u.includes('/api/search') ? responses.search
      : u.includes('/api/subscriptions') ? responses.subscriptions
      : { ok: true };
    return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
  }) as unknown as typeof fetch;
});

describe('AddWatchSheet', () => {
  it('未登入 + 有 onRequestLogin → 顯示「使用 LINE 登入」按鈕，點擊觸發登入', () => {
    const onRequestLogin = jest.fn();
    const { getByTestId } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId={null} groupCtxId={null} onRequestLogin={onRequestLogin} />
    );
    const btn = getByTestId('add-login');
    expect(btn.textContent).toContain('使用 LINE 登入');
    btn.click();
    expect(onRequestLogin).toHaveBeenCalled();
  });

  it('未登入 + 無 onRequestLogin → 只提示在 LINE 內開啟、不顯示登入按鈕', () => {
    const { container, queryByTestId } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId={null} groupCtxId={null} />
    );
    expect(container.textContent).toContain('登入後才能建立追蹤');
    expect(queryByTestId('add-login')).toBeNull();
  });

  it('有 sourceId → 顯示路線 picker + 來回/單程 segmented', () => {
    const { container } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    expect(container.textContent).toContain('來回');
    expect(container.textContent).toContain('單程');
  });

  it('未填日期 → preview button 是 disabled', () => {
    const { getByRole } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    const btn = getByRole('button', { name: /查目前最低價/ });
    expect(btn).toBeDisabled();
  });

  it('填好日期 → preview button enable + 點擊打 /api/search', async () => {
    responses.search = { ok: true, analysis: { cheapestRoundTripPrice: 12500, cheapestAirline: '酷航' }, fromCache: true };
    const { getByRole, getByLabelText, findAllByText, container } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    fireEvent.click(getByRole('button', { name: /查目前最低價/ }));
    const matches = await findAllByText(/12,500/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain('酷航');
    expect(container.textContent).toContain('快取');
  });

  it('preview 後點「目前價」suggestion → 帶入目標價 input', async () => {
    responses.search = { ok: true, analysis: { cheapestRoundTripPrice: 12500, cheapestAirline: 'X' } };
    const { getByRole, getByLabelText, findByTestId } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    fireEvent.click(getByRole('button', { name: /查目前最低價/ }));
    const pill = await findByTestId('pill-current');
    expect(pill.textContent).toContain('12,500');
    fireEvent.click(pill);
    const amountInput = (await findByTestId('target-amount')) as HTMLInputElement;
    expect(amountInput.value).toBe('12500');
  });

  it('submit 按鈕送出 POST /api/subscriptions 並 onCreated', async () => {
    responses.subscriptions = { ok: true, action: 'created' };
    const onCreated = jest.fn();
    const onClose = jest.fn();
    const { getByLabelText, getByText, findByTestId } = render(
      <AddWatchSheet open={true} onClose={onClose} userId="Uabc" groupCtxId={null} onCreated={onCreated} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    const amount = document.querySelector(String.raw`[data-testid="target-amount"]`) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '13000' } });
    fireEvent.click(getByText('開始追蹤'));
    await waitFor(() => {
      const calls = (global.fetch as unknown as jest.Mock).mock.calls;
      const postCall = calls.find(c => c[0] === '/api/subscriptions');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.maxPrice).toBe(13000);
      expect(body.outboundDate).toBe('2026-09-01');
      expect(body.returnDate).toBe('2026-09-05');
    });
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const success = await findByTestId('add-success');
    expect(success).toBeInTheDocument();
    fireEvent.click(await findByTestId('add-success-done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('add-success calm state → 顯示路線 + 目標價 + 接下來 3 行（PR #21 §4.9）', async () => {
    responses.subscriptions = { ok: true, action: 'created' };
    const { getByLabelText, getByText, findByTestId, container } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    const amount = document.querySelector(String.raw`[data-testid="target-amount"]`) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '13000' } });
    fireEvent.click(getByText('開始追蹤'));
    await findByTestId('add-success');
    expect(container.textContent).toContain('開始追蹤了');
    expect(container.textContent).toContain('13,000');
    expect(container.textContent).toContain('每天記錄');
    expect(container.textContent).toContain('LINE 立刻通知');
  });

  it('單程模式 → 隱藏回程 + POST body 不含 returnDate', async () => {
    responses.subscriptions = { ok: true };
    const { container, getByLabelText, getByText } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.click(getByText('單程'));
    expect(container.textContent).not.toMatch(/(?:^|\s)回程(?:\s|$)/);
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    const amount = document.querySelector(String.raw`[data-testid="target-amount"]`) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '13000' } });
    fireEvent.click(getByText('開始追蹤'));
    await waitFor(() => {
      const postCall = (global.fetch as unknown as jest.Mock).mock.calls.find(c => c[0] === '/api/subscriptions');
      const body = JSON.parse(postCall![1].body);
      expect(body.returnDate).toBeUndefined();
    });
  });

  it('航司過濾：route-airlines 回 2 家 → 顯示 2 個 chip（預設全勾）；取消一家 → POST 帶 airlineFilter', async () => {
    responses.routeAirlines = { ok: true, airlines: ['捷星', '星宇航空'] };
    responses.subscriptions = { ok: true, action: 'created' };
    const { getByLabelText, getByText, findByTestId } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    // chip 出現（掛載時 fetch route-airlines）
    const jetstar = await findByTestId('airline-捷星');
    const starlux = await findByTestId('airline-星宇航空');
    expect(jetstar.getAttribute('aria-pressed')).toBe('true');   // 預設全勾
    expect(starlux.getAttribute('aria-pressed')).toBe('true');
    // 取消星宇 → 只剩捷星
    fireEvent.click(starlux);
    expect(starlux.getAttribute('aria-pressed')).toBe('false');
    // 填單必要欄位 + 送出
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    const amount = document.querySelector(String.raw`[data-testid="target-amount"]`) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '13000' } });
    fireEvent.click(getByText('開始追蹤'));
    await waitFor(() => {
      const postCall = (global.fetch as unknown as jest.Mock).mock.calls.find(c => c[0] === '/api/subscriptions');
      const body = JSON.parse(postCall![1].body);
      expect(body.airlineFilter).toEqual(['捷星']);   // 只送縮小後的
    });
  });

  it('航司全勾（沒縮小）→ POST 不帶 airlineFilter（= 追全部）', async () => {
    responses.routeAirlines = { ok: true, airlines: ['捷星', '星宇航空'] };
    responses.subscriptions = { ok: true, action: 'created' };
    const { getByLabelText, getByText, findByTestId } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    await findByTestId('airline-捷星');  // 等清單載入（全勾）
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    const amount = document.querySelector(String.raw`[data-testid="target-amount"]`) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '13000' } });
    fireEvent.click(getByText('開始追蹤'));
    await waitFor(() => {
      const postCall = (global.fetch as unknown as jest.Mock).mock.calls.find(c => c[0] === '/api/subscriptions');
      const body = JSON.parse(postCall![1].body);
      expect(body.airlineFilter).toBeUndefined();
    });
  });
});
