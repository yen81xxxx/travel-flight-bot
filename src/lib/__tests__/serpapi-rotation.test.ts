/**
 * Multi-key rotation 純邏輯測試（不打 fetch / DB）。
 *
 * 為什麼測這個：
 *   之前 quota 用光 cron 卻一直跑空轉（serpapiCalls 計數錯+ AllKeysExhaustedError
 *   沒被外層攔截）讓 user 收到「查無資料」誤導。Multi-key rotation 是這套防線
 *   的核心，回歸風險高。
 *
 * 涵蓋：
 *   1. 第一支成功 → 不試其他 key
 *   2. 第一支 429 → 第二支成功 → 標記第一支 exhausted
 *   3. 全部 429 → throw AllKeysExhaustedError
 *   4. 已 exhausted 的 key 直接跳過、不打 callback
 *   5. 全部 keys 都 exhausted → 馬上 throw（不試任何 callback）
 *   6. 空 keys 陣列 → throw 設定錯誤
 *   7. 非 429 錯誤（e.g. 500 / timeout）→ 不換 key、立即往上拋
 *   8. 跨多次 call 共用同一 exhausted Set（模擬 cron 多 route 共用）
 */

import { rotateKeys, QuotaExceededError, AllKeysExhaustedError } from '../serpapi';

const fakeBody = '{"error":"quota"}';

// 建立 quota error helper
const quota = (key: string) => new QuotaExceededError(key, fakeBody);

describe('rotateKeys — multi-key rotation', () => {
  it('第一支成功 → 不試第二支', async () => {
    const exhausted = new Set<string>();
    const calls: string[] = [];
    const result = await rotateKeys(['k1', 'k2'], exhausted, async (key) => {
      calls.push(key);
      return `data-from-${key}`;
    });
    expect(result).toBe('data-from-k1');
    expect(calls).toEqual(['k1']);  // k2 沒被呼叫
    expect(exhausted.size).toBe(0);  // 沒人 exhausted
  });

  it('第一支 429 → 第二支成功 → 標記第一支 exhausted', async () => {
    const exhausted = new Set<string>();
    const calls: string[] = [];
    const result = await rotateKeys(['k1', 'k2'], exhausted, async (key) => {
      calls.push(key);
      if (key === 'k1') throw quota(key);
      return `data-from-${key}`;
    });
    expect(result).toBe('data-from-k2');
    expect(calls).toEqual(['k1', 'k2']);  // 兩支都試
    expect(exhausted.has('k1')).toBe(true);
    expect(exhausted.has('k2')).toBe(false);
  });

  it('全部 429 → throw AllKeysExhaustedError', async () => {
    const exhausted = new Set<string>();
    const calls: string[] = [];
    await expect(rotateKeys(['k1', 'k2', 'k3'], exhausted, async (key) => {
      calls.push(key);
      throw quota(key);
    })).rejects.toThrow(AllKeysExhaustedError);
    expect(calls).toEqual(['k1', 'k2', 'k3']);  // 都試過
    expect(exhausted.size).toBe(3);  // 全部標 exhausted
  });

  it('已 exhausted 的 key 直接跳過、不打 callback', async () => {
    const exhausted = new Set<string>(['k1']);
    const calls: string[] = [];
    const result = await rotateKeys(['k1', 'k2'], exhausted, async (key) => {
      calls.push(key);
      return `data-from-${key}`;
    });
    expect(result).toBe('data-from-k2');
    expect(calls).toEqual(['k2']);  // k1 被跳過
  });

  it('全部 keys 已 exhausted → 馬上 throw、不試任何 callback', async () => {
    const exhausted = new Set<string>(['k1', 'k2']);
    const calls: string[] = [];
    await expect(rotateKeys(['k1', 'k2'], exhausted, async (key) => {
      calls.push(key);
      return key;
    })).rejects.toThrow(AllKeysExhaustedError);
    expect(calls).toEqual([]);  // 一個都沒打
  });

  it('空 keys 陣列 → throw 設定錯誤', async () => {
    const exhausted = new Set<string>();
    await expect(rotateKeys([], exhausted, async () => 'never')).rejects.toThrow(
      /SERPAPI_KEYS \/ SERPAPI_KEY 都沒設定/
    );
  });

  it('非 429 錯誤 → 不換 key、立即拋出', async () => {
    const exhausted = new Set<string>();
    const calls: string[] = [];
    const networkErr = new Error('network timeout');
    await expect(rotateKeys(['k1', 'k2'], exhausted, async (key) => {
      calls.push(key);
      throw networkErr;  // 不是 QuotaExceededError
    })).rejects.toThrow('network timeout');
    expect(calls).toEqual(['k1']);  // k2 不該被嘗試
    expect(exhausted.size).toBe(0);  // k1 不該被標 exhausted（不是 quota 問題）
  });

  it('跨多次 call 共用同一 exhausted Set（模擬 cron 多 route 場景）', async () => {
    const exhausted = new Set<string>();
    // 第 1 次 call：k1 429 → 用 k2
    const r1 = await rotateKeys(['k1', 'k2'], exhausted, async (key) => {
      if (key === 'k1') throw quota(key);
      return 'first-' + key;
    });
    expect(r1).toBe('first-k2');
    expect(exhausted.has('k1')).toBe(true);

    // 第 2 次 call：k1 已被標 exhausted → 直接跳到 k2，不浪費 call 試 k1
    const calls: string[] = [];
    const r2 = await rotateKeys(['k1', 'k2'], exhausted, async (key) => {
      calls.push(key);
      return 'second-' + key;
    });
    expect(r2).toBe('second-k2');
    expect(calls).toEqual(['k2']);  // k1 完全沒被嘗試
  });

  it('第一支 429、第二支非配額錯 → 拋第二支的錯（不繼續輪換）', async () => {
    const exhausted = new Set<string>();
    const networkErr = new Error('connection reset');
    await expect(rotateKeys(['k1', 'k2', 'k3'], exhausted, async (key) => {
      if (key === 'k1') throw quota(key);
      if (key === 'k2') throw networkErr;
      return key;  // k3 不該被打到
    })).rejects.toThrow('connection reset');
    expect(exhausted.has('k1')).toBe(true);
    expect(exhausted.has('k2')).toBe(false);  // network error 不是 quota，不標 exhausted
  });
});

describe('QuotaExceededError', () => {
  it('保留 key 屬性給上層 log', () => {
    const err = new QuotaExceededError('my-key-1234', 'too many');
    expect(err.key).toBe('my-key-1234');
    expect(err.name).toBe('QuotaExceededError');
    expect(err.message).toContain('429');
    expect(err.message).toContain('too many');
    // key 顯示要 mask（前 4 / 後 4）
    expect(err.message).toContain('my-k');
    expect(err.message).toContain('1234');
  });

  it('短 key 用 **** 替代', () => {
    const err = new QuotaExceededError('short', 'body');
    expect(err.message).toContain('****');
  });
});

describe('AllKeysExhaustedError', () => {
  it('帶有明確 name 給上層用 instanceof 接', () => {
    const err = new AllKeysExhaustedError('test');
    expect(err.name).toBe('AllKeysExhaustedError');
    expect(err instanceof Error).toBe(true);
  });
});
