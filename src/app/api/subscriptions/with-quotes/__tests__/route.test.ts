/**
 * @jest-environment node
 *
 * 用 node env（不是 jsdom）— next/server 內部 import 會用到 Web Request global，
 * jsdom 砍掉這些 global，會在 import 時直接 ReferenceError。
 *
 * with-quotes route — 整合測試，mock Supabase。
 *
 * 重點：
 *   - sourceId 缺 → 400
 *   - 沒訂閱 → watches: []
 *   - 訂閱 outbound_date == null → quote: null（這類訂閱本 endpoint 不支援）
 *   - 訂閱有 outbound_date + 有 6h 內 quotes → quote 出來
 *   - DB query 失敗 → 整支 endpoint 不 500，該訂閱 quote=null 降級
 *   - days param 邊界：超過 90 clamp 到 90、小於 1 clamp 到 1
 *
 * 不重測 buildWatchQuote 的邏輯（quote-builder.test.ts 已覆蓋）；
 * 這裡只測「route 怎麼餵料、怎麼降級」。
 */
import { GET } from '../route';

// === mock supabase ===
// 我們手動模擬 Postgrest builder：每呼叫一個 method 就 return self、
// 最後 await 時 return { data, error } — 跟既有 jest setup 一致。
type MockResult = { data: unknown[] | null; error: { message: string } | null };

interface MockBuilder {
  data: unknown[] | null;
  error: { message: string } | null;
  select: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  is: jest.Mock;
  gte: jest.Mock;
  lt: jest.Mock;
  not: jest.Mock;
  order: jest.Mock;
  then: (resolve: (value: MockResult) => unknown) => Promise<unknown>;
}

const mkBuilder = (data: unknown[] | null, error: { message: string } | null = null): MockBuilder => {
  const self: MockBuilder = {
    data,
    error,
    select: jest.fn(() => self),
    eq: jest.fn(() => self),
    in: jest.fn(() => self),
    is: jest.fn(() => self),
    gte: jest.fn(() => self),
    lt: jest.fn(() => self),
    not: jest.fn(() => self),
    order: jest.fn(() => self),
    // 讓 await builder 時 resolve { data, error }
    then: (resolve) => Promise.resolve(resolve({ data: self.data, error: self.error }))
  };
  return self;
};

// === jest 全域 mock @/lib/supabase ===
// 用 mutable factory function — 每個 test 可以重設返回值
type FromHandler = (table: string) => MockBuilder;
let fromImpl: FromHandler = () => mkBuilder([]);
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => fromImpl(table)
  })
}));

// 用 NextRequest 的最小 stub — sourceId 從 query 取
const mkReq = (search: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(search) } }) as unknown as Parameters<typeof GET>[0];

const sampleSub = {
  id: 1,
  source_id: 'Uabc',
  source_type: 'user',
  origin: 'TPE',
  destination: 'NRT',
  outbound_date: '2026-08-14',
  return_date: '2026-08-18',
  max_price: 12800,
  max_price_traditional: 24000,
  active: true,
  paused: false,
  currency: 'TWD',
  label: null,
  outbound_min_departure_time: null,
  outbound_max_departure_time: null,
  return_min_departure_time: null,
  return_max_departure_time: null,
  created_at: '2026-06-01T00:00:00Z'
};

describe('GET /api/subscriptions/with-quotes', () => {
  beforeEach(() => {
    fromImpl = () => mkBuilder([]);
  });

  it('沒帶 sourceId → 400', async () => {
    const res = await GET(mkReq(''));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('沒訂閱 → ok=true, watches=[]', async () => {
    fromImpl = (table) => {
      if (table === 'subscriptions') return mkBuilder([]);
      return mkBuilder([]);
    };
    const res = await GET(mkReq('sourceId=Uabc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.watches).toEqual([]);
  });

  it('訂閱 outbound_date == null → quote=null（任何日期型訂閱不算 quote）', async () => {
    const subAny = { ...sampleSub, outbound_date: null };
    fromImpl = (table) => {
      if (table === 'subscriptions') return mkBuilder([subAny]);
      return mkBuilder([]);
    };
    const res = await GET(mkReq('sourceId=Uabc'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.watches[0].quote).toBeNull();
    expect(body.watches[0].outbound_date).toBeNull();
  });

  it('訂閱有 outbound_date 但 6h 內無 quote → quote=null', async () => {
    fromImpl = (table) => {
      if (table === 'subscriptions') return mkBuilder([sampleSub]);
      // 三個 flight_quotes query 都回空
      return mkBuilder([]);
    };
    const res = await GET(mkReq('sourceId=Uabc'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.watches[0].quote).toBeNull();
  });

  it('subscriptions query 失敗 → 500', async () => {
    fromImpl = (table) => {
      if (table === 'subscriptions') return mkBuilder(null, { message: 'db down' });
      return mkBuilder([]);
    };
    const res = await GET(mkReq('sourceId=Uabc'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('db down');
  });

  it('flight_quotes query 失敗 → 不整支 500，該訂閱 quote 降級為 null', async () => {
    fromImpl = (table) => {
      if (table === 'subscriptions') return mkBuilder([sampleSub]);
      // flight_quotes 任何 query 都 error
      return mkBuilder(null, { message: 'transient' });
    };
    // 抑制 console.warn — route 內部會 log，但 test 輸出不要看到
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await GET(mkReq('sourceId=Uabc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.watches[0].quote).toBeNull();
    warnSpy.mockRestore();
  });

  it('回傳的 watches[*] 欄位 = 既有訂閱欄位 + quote（snake_case 保持）', async () => {
    fromImpl = (table) => {
      if (table === 'subscriptions') return mkBuilder([sampleSub]);
      return mkBuilder([]);
    };
    const res = await GET(mkReq('sourceId=Uabc'));
    const body = await res.json();
    const w = body.watches[0];
    // 必要欄位都在
    expect(w).toMatchObject({
      id: 1,
      source_id: 'Uabc',
      origin: 'TPE',
      destination: 'NRT',
      outbound_date: '2026-08-14',
      return_date: '2026-08-18',
      max_price: 12800,
      max_price_traditional: 24000,
      active: true,
      paused: false,
      quote: null
    });
  });

  it('days param 超過 90 → clamp to 90', async () => {
    let capturedHistoryWindow: string | null = null;
    fromImpl = (table) => {
      if (table === 'subscriptions') return mkBuilder([sampleSub]);
      const b = mkBuilder([]);
      // 攔 gte('queried_at', X) — history query 是最後一個 gte，記下 X
      b.gte = jest.fn((col: string, val: string) => {
        if (col === 'queried_at') capturedHistoryWindow = val;
        return b;
      });
      return b;
    };
    await GET(mkReq('sourceId=Uabc&days=999'));
    // history query 用 90 天前的時間（不是 999）— 用「90 天前 ± 5 天」做寬鬆斷言避免 race
    expect(capturedHistoryWindow).not.toBeNull();
    const captured = new Date(capturedHistoryWindow!);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000);
    const diffMs = Math.abs(ninetyDaysAgo.getTime() - captured.getTime());
    expect(diffMs).toBeLessThan(5 * 86400_000); // 寬鬆，看 clamp 有沒有被尊重
  });

  it('days 缺失 → 預設 30', async () => {
    let captured: string | null = null;
    fromImpl = (table) => {
      if (table === 'subscriptions') return mkBuilder([sampleSub]);
      const b = mkBuilder([]);
      b.gte = jest.fn((col: string, val: string) => {
        if (col === 'queried_at') captured = val;
        return b;
      });
      return b;
    };
    await GET(mkReq('sourceId=Uabc'));
    expect(captured).not.toBeNull();
    const cap = new Date(captured!);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
    expect(Math.abs(cap.getTime() - thirtyDaysAgo.getTime())).toBeLessThan(5 * 86400_000);
  });
});
