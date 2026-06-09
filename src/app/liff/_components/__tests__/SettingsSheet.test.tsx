/**
 * SettingsSheet — open + GET 撈設定 + POST 儲存 + sourceId 缺 fallback
 *
 * Mock fetch 全域（jest 預設沒裝），把 GET/POST 路由分開回應。
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { SettingsSheet } from '../SettingsSheet';

describe('SettingsSheet', () => {
  beforeEach(() => {
    // 預設：GET 回 empty settings、POST 回 ok
    global.fetch = jest.fn((url: string | URL, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/api/notification-settings') && (!init || init.method === undefined || init.method === 'GET')) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, settings: null })
        } as Response);
      }
      if (u.includes('/api/notification-settings') && init?.method === 'POST') {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true })
        } as Response);
      }
      return Promise.reject(new Error('unmocked: ' + u));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    (global.fetch as unknown as jest.Mock).mockReset?.();
  });

  it('sourceId=null → 顯示「需要先登入 LINE」提示', () => {
    const { container } = render(
      <SettingsSheet open={true} onClose={() => {}} sourceId={null} />
    );
    expect(container.textContent).toContain('需要先登入');
  });

  it('open=true + sourceId 有值 → 打 GET /api/notification-settings', async () => {
    render(<SettingsSheet open={true} onClose={() => {}} sourceId="Uabc" />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notification-settings?sourceId=Uabc')
      );
    });
  });

  it('GET 回設定 → 帶到 form state', async () => {
    (global.fetch as unknown as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        json: () => Promise.resolve({
          ok: true,
          settings: { daily_summary: false, quiet_start: '23:00', quiet_end: '07:30' }
        })
      })
    );
    const { container, findByText } = render(
      <SettingsSheet open={true} onClose={() => {}} sourceId="Uabc" />
    );
    // 等載入完成 — 「每日摘要」row 顯示時 IOSToggle 已套 false
    await findByText('每日摘要');
    // 靜音時段已開啟 → 應該看得到 time picker（"從" / "到"）
    await waitFor(() => {
      expect(container.textContent).toContain('從');
    });
  });

  it('儲存按鈕點擊 → POST 送出設定', async () => {
    const { findByText } = render(
      <SettingsSheet open={true} onClose={() => {}} sourceId="Uabc" />
    );
    const saveBtn = await findByText('儲存設定');
    fireEvent.click(saveBtn);
    await waitFor(() => {
      const calls = (global.fetch as unknown as jest.Mock).mock.calls;
      const postCall = calls.find(c => c[1]?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.sourceId).toBe('Uabc');
      expect(body.timezone).toBe('Asia/Taipei');
    });
  });

  it('儲存錯誤 → 顯示 error', async () => {
    (global.fetch as unknown as jest.Mock)
      .mockImplementationOnce(() => Promise.resolve({
        json: () => Promise.resolve({ ok: true, settings: null })
      })) // GET
      .mockImplementationOnce(() => Promise.resolve({
        json: () => Promise.resolve({ ok: false, error: '儲存失敗了' })
      })); // POST
    const { findByText, getByText } = render(
      <SettingsSheet open={true} onClose={() => {}} sourceId="Uabc" />
    );
    fireEvent.click(await findByText('儲存設定'));
    await waitFor(() => {
      expect(getByText('儲存失敗了')).toBeInTheDocument();
    });
  });
});
