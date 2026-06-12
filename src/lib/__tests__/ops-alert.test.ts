/**
 * R4-B — cron 失敗告警
 *
 * 為什麼測這些：
 *   1. 觸發條件是「系統性訊號」（全 key 爆 / push 失敗）— 個別訂閱錯誤
 *      不能單獨觸發（太吵 = admin 麻木 = 告警失效）
 *   2. 同一天只發一次（dedup 靠 search_runs 既有資料，零 schema 改動）
 *   3. 告警本身失敗不能炸 cron（告警是保險，不是主功能）
 *   4. 文案零 emoji、【】結構（同 A5 語言）
 */
import { shouldSendOpsAlert, buildOpsAlertText, sendOpsAlertIfNeeded } from '../ops-alert';

jest.mock('../line', () => ({
  pushText: jest.fn().mockResolvedValue(undefined)
}));
import { pushText } from '../line';

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}]/u;

/** supabase mock — search_runs select chain 回固定 rows */
function mockSupabase(todayFailedRuns: number) {
  return {
    from: () => ({
      select: () => ({
        gte: () => ({
          neq: () => ({
            limit: () => Promise.resolve({
              data: Array.from({ length: todayFailedRuns }, (_, i) => ({ id: i + 1 }))
            })
          })
        })
      })
    })
  };
}

describe('shouldSendOpsAlert（觸發條件）', () => {
  it('全 key 爆 or push 失敗 → 觸發；只有個別訂閱錯誤 → 不觸發（防告警疲勞）', () => {
    expect(shouldSendOpsAlert({ allKeysExhausted: true, pushedFail: 0, subErrors: 0 })).toBe(true);
    expect(shouldSendOpsAlert({ allKeysExhausted: false, pushedFail: 2, subErrors: 0 })).toBe(true);
    expect(shouldSendOpsAlert({ allKeysExhausted: false, pushedFail: 0, subErrors: 5 })).toBe(false);
    expect(shouldSendOpsAlert({ allKeysExhausted: false, pushedFail: 0, subErrors: 0 })).toBe(false);
  });
});

describe('buildOpsAlertText', () => {
  it('零 emoji、【系統告警】結構、按訊號組句', () => {
    const text = buildOpsAlertText(
      { allKeysExhausted: true, pushedFail: 2, subErrors: 3 },
      '2026-06-12'
    );
    expect(text).not.toMatch(EMOJI_RE);
    expect(text).toContain('【系統告警】Travl cron 異常（2026-06-12）');
    expect(text).toContain('SerpApi 全部 key 今日配額用盡');
    expect(text).toContain('推播失敗 2 則');
    expect(text).toContain('3 筆訂閱檢查錯誤');
    expect(text).toContain('明日重置後自動恢復');
  });

  it('單一訊號 → 不相干的句子不出現', () => {
    const text = buildOpsAlertText(
      { allKeysExhausted: true, pushedFail: 0, subErrors: 0 },
      '2026-06-12'
    );
    expect(text).not.toContain('推播失敗');
    expect(text).not.toContain('訂閱檢查錯誤');
  });
});

describe('sendOpsAlertIfNeeded', () => {
  const SIGNALS = { allKeysExhausted: true, pushedFail: 0, subErrors: 0 };

  beforeEach(() => {
    (pushText as jest.Mock).mockClear();
    process.env.LINE_DAILY_PUSH_TARGET = 'Uadmin123';
  });

  it('今天第一次失敗（本次 run 的 1 筆 partial）→ 發送', async () => {
    const r = await sendOpsAlertIfNeeded(mockSupabase(1), SIGNALS);
    expect(r).toEqual({ sent: true, reason: 'sent' });
    expect(pushText).toHaveBeenCalledWith('Uadmin123', expect.stringContaining('【系統告警】'));
  });

  it('今天已有 ≥2 筆非 success（先前已告警）→ skip', async () => {
    const r = await sendOpsAlertIfNeeded(mockSupabase(2), SIGNALS);
    expect(r).toEqual({ sent: false, reason: 'already-alerted-today' });
    expect(pushText).not.toHaveBeenCalled();
  });

  it('無訊號 → 不發、不查 DB', async () => {
    const r = await sendOpsAlertIfNeeded(mockSupabase(0), { allKeysExhausted: false, pushedFail: 0, subErrors: 0 });
    expect(r).toEqual({ sent: false, reason: 'no-signal' });
  });

  it('admin target 未設 → 只 log 不炸', async () => {
    delete process.env.LINE_DAILY_PUSH_TARGET;
    const r = await sendOpsAlertIfNeeded(mockSupabase(1), SIGNALS);
    expect(r).toEqual({ sent: false, reason: 'no-admin-target' });
  });

  it('pushText 失敗 → 回 push-failed、不 throw（cron 不能因告警死掉）', async () => {
    (pushText as jest.Mock).mockRejectedValueOnce(new Error('LINE quota exceeded'));
    const r = await sendOpsAlertIfNeeded(mockSupabase(1), SIGNALS);
    expect(r).toEqual({ sent: false, reason: 'push-failed' });
  });
});
