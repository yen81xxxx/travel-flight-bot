/**
 * @jest-environment node
 *
 * GET /api/group-watch/my-memberships?userId=X — mock supabase 測
 *
 * 跟 with-quotes/route.test.ts 同樣 mock pattern。
 */
import { GET } from '../route';

interface MockResult { data: unknown[] | null; error: { message: string } | null }
interface MockBuilder {
  data: unknown[] | null;
  error: { message: string } | null;
  select: jest.Mock; eq: jest.Mock;
  then: (resolve: (r: MockResult) => unknown) => Promise<unknown>;
}
const mkBuilder = (data: unknown[] | null, error: MockBuilder['error'] = null): MockBuilder => {
  const self: MockBuilder = {
    data, error,
    select: jest.fn(() => self), eq: jest.fn(() => self),
    then: (resolve) => Promise.resolve(resolve({ data: self.data, error: self.error }))
  };
  return self;
};

let fromImpl: (table: string) => MockBuilder = () => mkBuilder([]);
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: (table: string) => fromImpl(table) })
}));

const mkReq = (search: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(search) } }) as unknown as Parameters<typeof GET>[0];

describe('GET /api/group-watch/my-memberships', () => {
  beforeEach(() => { fromImpl = () => mkBuilder([]); });

  it('沒帶 userId → 400', async () => {
    const res = await GET(mkReq(''));
    expect(res.status).toBe(400);
  });

  it('user 沒加入任何 group watch → ok=true + 空 list（不是錯）', async () => {
    fromImpl = () => mkBuilder([]);
    const res = await GET(mkReq('userId=Uabc'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.subscriptionIds).toEqual([]);
  });

  it('user 有 3 個 memberships → 回 3 個 subscription_id', async () => {
    fromImpl = () => mkBuilder([
      { subscription_id: 10 },
      { subscription_id: 20 },
      { subscription_id: 30 }
    ]);
    const res = await GET(mkReq('userId=Uabc'));
    const body = await res.json();
    expect(body.subscriptionIds.sort()).toEqual([10, 20, 30]);
  });

  it('資料庫有重複 row（不該發生但保險）→ dedup', async () => {
    fromImpl = () => mkBuilder([
      { subscription_id: 10 },
      { subscription_id: 10 },  // dup
      { subscription_id: 20 }
    ]);
    const res = await GET(mkReq('userId=Uabc'));
    const body = await res.json();
    expect(body.subscriptionIds).toHaveLength(2);
    expect(body.subscriptionIds.sort()).toEqual([10, 20]);
  });

  it('DB error → 500', async () => {
    fromImpl = () => mkBuilder(null, { message: 'connection refused' });
    const res = await GET(mkReq('userId=Uabc'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('connection refused');
  });
});
