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

  it('釘選航班（複選）：preview 後勾兩班 → POST 帶 pinnedFlightNumbers/Labels 陣列 + 最低價，不帶 airlineFilter', async () => {
    responses.routeAirlines = { ok: true, airlines: ['捷星', '星宇航空'] };
    responses.search = {
      ok: true,
      analysis: { cheapestRoundTripPrice: 6000, cheapestAirline: '捷星' },
      outbound: [
        { airline: '捷星', price: 6000, raw: { flights: [{ flight_number: 'GK 13', departure_airport: { time: '2026-09-01 08:30' } }] } },
        { airline: '星宇航空', price: 9000, raw: { flights: [{ flight_number: 'JX 803', departure_airport: { time: '2026-09-01 14:00' } }] } }
      ]
    };
    responses.subscriptions = { ok: true, action: 'created' };
    const { getByLabelText, getByText, getByRole, getByTestId, findByTestId, queryByTestId } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    fireEvent.click(getByRole('button', { name: /查目前最低價/ }));
    // 航班清單出現 → 複選兩班（星宇 9000 + 捷星 6000）
    const jx = await findByTestId('pin-JX 803');
    fireEvent.click(jx);
    fireEvent.click(getByTestId('pin-GK 13'));
    // 釘選後航司勾選 chip 應隱藏（釘選優先）
    expect(queryByTestId('airline-捷星')).toBeNull();
    fireEvent.click(getByText('開始追蹤'));
    await waitFor(() => {
      const postCall = (global.fetch as unknown as jest.Mock).mock.calls.find(c => c[0] === '/api/subscriptions');
      const body = JSON.parse(postCall![1].body);
      expect(body.pinnedFlightNumbers).toEqual(expect.arrayContaining(['JX 803', 'GK 13']));
      expect(body.pinnedFlightNumbers).toHaveLength(2);
      expect(body.pinnedFlightLabels).toEqual(expect.arrayContaining(['星宇航空 · 14:00', '捷星 · 08:30']));
      expect(body.maxPrice).toBe(6000);            // 複選自動帶入「最低那班」的價
      expect(body.airlineFilter).toBeUndefined();  // 釘選優先 → 不送航司過濾
    });
  });
});

describe('AddWatchSheet — 開口式來回（0015）', () => {
  it('單程時不顯示「回程不同地點」開關', () => {
    const { getByText, queryByTestId } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.click(getByText('單程'));
    expect(queryByTestId('openjaw-toggle')).toBeNull();
  });

  it('開「回程不同地點」→ 送 returnOrigin/returnDestination（預設帶對稱值）', async () => {
    const { getByLabelText, getByText, getByTestId } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    fireEvent.click(getByTestId('openjaw-toggle'));   // 預設 returnOrigin=NRT(去程抵達), returnDestination=TPE(去程出發)
    const amount = document.querySelector(String.raw`[data-testid="target-amount"]`) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '13000' } });
    fireEvent.click(getByText('開始追蹤'));
    await waitFor(() => {
      const postCall = (global.fetch as unknown as jest.Mock).mock.calls.find(c => c[0] === '/api/subscriptions');
      const body = JSON.parse(postCall![1].body);
      expect(body.returnOrigin).toBe('NRT');
      expect(body.returnDestination).toBe('TPE');
      expect(body.returnDate).toBe('2026-09-05');
    });
  });

  const mkCombo = (outAir: string, outNo: string, backAir: string, backNo: string, total: number) => ({
    out: { airline: outAir, flightNumber: outNo, origin: 'TPE', destination: 'NRT', depTime: '13:30', arrTime: '17:30', price: total - 13000 },
    back: { airline: backAir, flightNumber: backNo, origin: 'HND', destination: 'TSA', depTime: '07:55', arrTime: '10:55', price: 13000 },
    total
  });

  it('開口式：預覽 → 送 paired:true legs、顯示「去+回 兩段相加」最低總價', async () => {
    responses.search = { ok: true, paired: true, cheapestTotal: 19791, combos: [mkCombo('泰國獅航', 'SL 394', '中華航空', 'CI 223', 19791)] };
    const { getByLabelText, getByRole, getByTestId, container } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    fireEvent.click(getByTestId('openjaw-toggle'));
    const previewBtn = getByRole('button', { name: /查目前最低價/ });
    expect(previewBtn).not.toBeDisabled();
    fireEvent.click(previewBtn);
    // /api/search 帶 paired:true + legs（去 + 回）→ 顯示最便宜配對總價 19,791
    await waitFor(() => {
      const searchCalls = (global.fetch as unknown as jest.Mock).mock.calls.filter(c => c[0] === '/api/search');
      const body = JSON.parse(searchCalls[0][1].body);
      expect(body.paired).toBe(true);
      expect(body.legs).toHaveLength(2);
      expect(body.legs[0]).toMatchObject({ origin: 'TPE', destination: 'NRT', date: '2026-09-01' });
      expect(container.textContent).toContain('19,791');
    });
    expect(container.textContent).toContain('兩段相加');
  });

  it('開口式：列出多組「去+回 配對」卡，每組去/回兩段航班、地點、起降、總價都在', async () => {
    responses.search = {
      ok: true, paired: true, cheapestTotal: 19791,
      combos: [
        mkCombo('泰國獅航', 'SL 394', '中華航空', 'CI 223', 19791),
        mkCombo('台灣虎航', 'IT 202', '長榮航空', 'BR 189', 20334),
        mkCombo('酷航', 'TR 874', '中華航空', 'CI 223', 20928)
      ]
    };
    const { getByLabelText, getByRole, getByTestId, getAllByTestId, container } = render(
      <AddWatchSheet open={true} onClose={() => {}} userId="Uabc" groupCtxId={null} />
    );
    fireEvent.change(getByLabelText(/去程/) as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText(/回程/) as HTMLInputElement, { target: { value: '2026-09-05' } });
    fireEvent.click(getByTestId('openjaw-toggle'));
    fireEvent.click(getByRole('button', { name: /查目前最低價/ }));

    // 配對卡出現、3 組
    await waitFor(() => expect(getByTestId('oj-list')).toBeInTheDocument());
    const cards = getAllByTestId('oj-combo');
    expect(cards).toHaveLength(3);
    // 第一張（最便宜）：去 泰獅 + 回 中華，兩段地點/起降/班號/總價都在
    const c0 = cards[0].textContent ?? '';
    expect(c0).toContain('最低');
    expect(c0).toContain('泰國獅航');         // 去段航司
    expect(c0).toContain('中華航空');         // 回段航司
    expect(c0).toContain('TPE→NRT');          // 去段地點
    expect(c0).toContain('HND→TSA');          // 回段地點
    expect(c0).toContain('13:30-17:30');      // 去段起降
    expect(c0).toContain('07:55-10:55');      // 回段起降
    expect(c0).toContain('19,791');           // 兩段相加總價
    // 其他組的航司也在
    expect(container.textContent).toContain('台灣虎航');
    expect(container.textContent).toContain('長榮航空');
  });
});
