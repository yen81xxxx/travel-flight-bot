/**
 * AddWatchSheet — sourceId null fallback + preview button 行為 + submit
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { AddWatchSheet } from '../AddWatchSheet';

describe('AddWatchSheet', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('sourceId=null → 顯示「需要先登入 LINE」提示', () => {
    const { container } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId={null} groupCtxId={null} />
    );
    expect(container.textContent).toContain('需要先登入');
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
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: true,
        analysis: { cheapestRoundTripPrice: 12500, cheapestAirline: '酷航' },
        fromCache: true
      })
    });
    const { getByRole, getByLabelText, findAllByText, container } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    // 填日期
    const outInput = getByLabelText(/去程/) as HTMLInputElement;
    fireEvent.change(outInput, { target: { value: '2026-09-01' } });
    const retInput = getByLabelText(/回程/) as HTMLInputElement;
    fireEvent.change(retInput, { target: { value: '2026-09-05' } });
    // 點 preview
    const btn = getByRole('button', { name: /查目前最低價/ });
    fireEvent.click(btn);
    // 12,500 可能同時出現在 preview block + 「目前價」suggestion pill 兩處 → 用 AllByText
    const matches = await findAllByText(/12,500/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // 顯示「酷航」+ 快取 hint
    expect(container.textContent).toContain('酷航');
    expect(container.textContent).toContain('快取');
  });

  it('preview 後點「目前價」suggestion → 帶入目標價 input', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: true,
        analysis: { cheapestRoundTripPrice: 12500, cheapestAirline: 'X' }
      })
    });
    const { getByRole, getByLabelText, findAllByText } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    fireEvent.click(getByRole('button', { name: /查目前最低價/ }));
    // 等 preview 結果出現，然後直接挑「目前價」button（不是 preview 顯示的那個）
    const matches = await findAllByText(/目前價.*12,500/);
    // 找到那個是 button（pill），不是 label
    const pill = matches.find(el => el.tagName === 'BUTTON');
    expect(pill).toBeDefined();
    fireEvent.click(pill!);
    // 看 amount input 值
    const amountInput = document.querySelector('input[placeholder="例：12800"]') as HTMLInputElement;
    expect(amountInput.value).toBe('12500');
  });

  it('submit 按鈕送出 POST /api/subscriptions 並 onCreated', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, action: 'created' })
    });
    const onCreated = jest.fn();
    const onClose = jest.fn();
    const { getByLabelText, getByText, findByTestId } = render(
      <AddWatchSheet open={true} onClose={onClose} userId="Uabc" groupCtxId={null} onCreated={onCreated} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    const amount = document.querySelector('input[placeholder="例：12800"]') as HTMLInputElement;
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
    // PR #21 (§4.9): 成功後不再默默關 — 顯示 calm state，user 按「完成」才關
    expect(onClose).not.toHaveBeenCalled();
    const success = await findByTestId('add-success');
    expect(success).toBeInTheDocument();
    fireEvent.click(await findByTestId('add-success-done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('add-success calm state → 顯示路線 + 目標價 + 接下來 3 行（PR #21 §4.9）', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, action: 'created' })
    });
    const { getByLabelText, getByText, findByTestId, container } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    const amount = document.querySelector('input[placeholder="例：12800"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '13000' } });
    fireEvent.click(getByText('開始追蹤'));
    await findByTestId('add-success');
    expect(container.textContent).toContain('開始追蹤了');
    expect(container.textContent).toContain('13,000');           // 目標價
    expect(container.textContent).toContain('每天記錄');          // 接下來 3 行
    expect(container.textContent).toContain('LINE 立刻通知');
  });

  it('單程模式 → 隱藏回程 + POST body 不含 returnDate', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true })
    });
    const { container, getByLabelText, getByText } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.click(getByText('單程'));
    // 回程 label 不存在
    expect(container.textContent).not.toMatch(/(?:^|\s)回程(?:\s|$)/);
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    const amount = document.querySelector('input[placeholder="例：12800"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '13000' } });
    fireEvent.click(getByText('開始追蹤'));
    await waitFor(() => {
      const postCall = (global.fetch as unknown as jest.Mock).mock.calls.find(c => c[0] === '/api/subscriptions');
      const body = JSON.parse(postCall![1].body);
      expect(body.returnDate).toBeUndefined();
    });
  });
});
