/**
 * notification-settings schema + buildSettingsUpsert（#6 局部更新硬化）
 *
 * 為什麼測：之前 quiet 欄位必填 → 只想改 dailySummary 的呼叫端會把靜音時段
 * 洗成 null（CLAUDE.md 點名的「空字串 vs null」坑）。改 optional 後，
 * undefined 欄位不能出現在 payload（否則 upsert 還是會覆蓋）。
 */
import { PostBody, buildSettingsUpsert } from '../schema';

describe('PostBody — 欄位都 optional（除 sourceId）', () => {
  it('只給 sourceId → 合法', () => {
    expect(PostBody.safeParse({ sourceId: 'Uabc' }).success).toBe(true);
  });
  it('沒 sourceId → 不合法', () => {
    expect(PostBody.safeParse({ dailySummary: true }).success).toBe(false);
  });
  it('quiet 時間格式錯 → 不合法；null 可接受（清掉）', () => {
    expect(PostBody.safeParse({ sourceId: 'U', quietStart: '25:00' }).success).toBe(false);
    expect(PostBody.safeParse({ sourceId: 'U', quietStart: null }).success).toBe(true);
    expect(PostBody.safeParse({ sourceId: 'U', quietStart: '22:30' }).success).toBe(true);
  });
});

describe('buildSettingsUpsert — undefined 不出現（局部更新不洗值）', () => {
  it('只改 dailySummary → payload 不含 quiet_start/quiet_end/timezone', () => {
    const row = buildSettingsUpsert({ sourceId: 'Uabc', dailySummary: false });
    expect(row).toHaveProperty('source_id', 'Uabc');
    expect(row).toHaveProperty('daily_summary', false);
    expect(row).not.toHaveProperty('quiet_start');
    expect(row).not.toHaveProperty('quiet_end');
    expect(row).not.toHaveProperty('timezone');
    expect(row).not.toHaveProperty('default_notify_target');
  });

  it('明確送 null → 寫 null（清掉靜音時段）', () => {
    const row = buildSettingsUpsert({ sourceId: 'U', quietStart: null, quietEnd: null });
    expect(row).toHaveProperty('quiet_start', null);
    expect(row).toHaveProperty('quiet_end', null);
  });

  it('全送 → 全部進 payload', () => {
    const row = buildSettingsUpsert({
      sourceId: 'U', quietStart: '22:00', quietEnd: '08:00', timezone: 'Asia/Taipei',
      dailySummary: true, priceAlerts: true, defaultNotifyTarget: 'group'
    });
    expect(row).toMatchObject({
      source_id: 'U', quiet_start: '22:00', quiet_end: '08:00', timezone: 'Asia/Taipei',
      daily_summary: true, price_alerts: true, default_notify_target: 'group'
    });
  });
});
