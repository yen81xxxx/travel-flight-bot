/**
 * @jest-environment node
 *
 * /api/group-watch/[id] — join / leave / GET members
 *
 * Mock supabase 兩張表：
 *   - subscriptions: 驗證 source_type='group' 才接受 join/leave
 *   - group_member: upsert (join) / delete (leave) / select (GET)
 */
import { GET, POST } from '../route';

interface MockResult { data: unknown | unknown[] | null; error: { message: string } | null }
interface MockBuilder {
  data: unknown[] | unknown | null;
  error: { message: string } | null;
  select: jest.Mock; eq: jest.Mock; order: jest.Mock; upsert: jest.Mock;
  delete: jest.Mock; update: jest.Mock; in: jest.Mock; maybeSingle: jest.Mock;
  then: (resolve: (r: MockResult) => unknown) => Promise<unknown>;
}
const mkBuilder = (data: MockBuilder['data'], error: MockBuilder['error'] = null): MockBuilder => {
  const self: MockBuilder = {
    data, error,
    select: jest.fn(() => self),
    eq: jest.fn(() => self),
    order: jest.fn(() => self),
    upsert: jest.fn(() => self),
    delete: jest.fn(() => self),
    update: jest.fn(() => self),
    in: jest.fn(() => self),
    // maybeSingle 走「拿陣列第一個」邏輯：data 是 array → first or null；
    // 是 object 直接回；null 回 null
    maybeSingle: jest.fn(() => {
      if (Array.isArray(data)) return Promise.resolve({ data: data[0] ?? null, error });
      return Promise.resolve({ data, error });
    }),
    // .then (await builder) 走「拿陣列」邏輯：data 是 array → 全部；
    // 是 object → 包成 [object]（給沒設 maybeSingle 的 caller 拿到 array）
    then: (resolve) => {
      const out = Array.isArray(data) ? data : (data == null ? [] : [data]);
      return Promise.resolve(resolve({ data: out, error }));
    }
  };
  return self;
};

let subscriptionsBuilder: MockBuilder = mkBuilder({ id: 1, source_type: 'group' });
let groupMemberBuilder: MockBuilder = mkBuilder([]);

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'subscriptions') return subscriptionsBuilder;
      if (table === 'group_member') return groupMemberBuilder;
      throw new Error('unexpected table: ' + table);
    }
  })
}));

const mkReq = (body?: object) =>
  ({
    json: () => Promise.resolve(body),
    url: 'http://localhost/api/group-watch/1',
    nextUrl: { searchParams: new URLSearchParams() }
  }) as unknown as Parameters<typeof POST>[0];

const mkParams = (id: string) => ({ params: { id } });

describe('GET /api/group-watch/[id]', () => {
  beforeEach(() => {
    groupMemberBuilder = mkBuilder([]);
  });

  it('invalid id → 400', async () => {
    const res = await GET(mkReq(), mkParams('garbage'));
    expect(res.status).toBe(400);
  });

  it('正常 → 回 members[]', async () => {
    groupMemberBuilder = mkBuilder([
      { line_user_id: 'Uabc', display_name: 'Alice', accepted_target: 12000, joined_at: '2026-06-01' },
      { line_user_id: 'Uxyz', display_name: 'Bob',   accepted_target: 13500, joined_at: '2026-06-02' }
    ]);
    const res = await GET(mkReq(), mkParams('5'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.members).toHaveLength(2);
    expect(body.members[0].line_user_id).toBe('Uabc');
  });

  it('DB error → 500', async () => {
    groupMemberBuilder = mkBuilder(null, { message: 'oops' });
    const res = await GET(mkReq(), mkParams('5'));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/group-watch/[id] — join', () => {
  beforeEach(() => {
    subscriptionsBuilder = mkBuilder({ id: 1, source_type: 'group' });
    groupMemberBuilder = mkBuilder([]);
  });

  it('invalid id → 400', async () => {
    const res = await POST(mkReq({ action: 'join', userId: 'Uabc' }), mkParams('NaN'));
    expect(res.status).toBe(400);
  });

  it('沒 action → 400', async () => {
    const res = await POST(mkReq({ userId: 'Uabc' }), mkParams('1'));
    expect(res.status).toBe(400);
  });

  it('沒 userId → 400', async () => {
    const res = await POST(mkReq({ action: 'join' }), mkParams('1'));
    expect(res.status).toBe(400);
  });

  it('subscription 不存在 → 404', async () => {
    subscriptionsBuilder = mkBuilder(null);
    const res = await POST(mkReq({ action: 'join', userId: 'Uabc' }), mkParams('99'));
    expect(res.status).toBe(404);
  });

  it('subscription 是個人訂閱 → 400 (禁止往個人訂閱加 member)', async () => {
    subscriptionsBuilder = mkBuilder({ id: 99, source_type: 'user' });
    const res = await POST(mkReq({ action: 'join', userId: 'Uabc' }), mkParams('99'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('group');
  });

  it('正常 join → upsert + 回 action=joined', async () => {
    const res = await POST(mkReq({ action: 'join', userId: 'Uabc', displayName: 'Alice' }), mkParams('1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe('joined');
    expect(groupMemberBuilder.upsert).toHaveBeenCalled();
  });

  it('重複 join (idempotent) → 仍回 200 (upsert 不會炸)', async () => {
    const res = await POST(mkReq({ action: 'join', userId: 'Uabc' }), mkParams('1'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/group-watch/[id] — leave', () => {
  beforeEach(() => {
    subscriptionsBuilder = mkBuilder({ id: 1, source_type: 'group' });
    groupMemberBuilder = mkBuilder([]);
  });

  it('正常 leave → delete + 回 action=left', async () => {
    const res = await POST(mkReq({ action: 'leave', userId: 'Uabc' }), mkParams('1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('left');
    expect(groupMemberBuilder.delete).toHaveBeenCalled();
  });

  it('leave 不是 member 的人 (idempotent) → 仍回 200', async () => {
    const res = await POST(mkReq({ action: 'leave', userId: 'Uxxx' }), mkParams('1'));
    expect(res.status).toBe(200);
  });

  it('subscription 是個人訂閱 → 400', async () => {
    subscriptionsBuilder = mkBuilder({ id: 99, source_type: 'user' });
    const res = await POST(mkReq({ action: 'leave', userId: 'Uabc' }), mkParams('99'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/group-watch/[id] — set-target (G2)', () => {
  beforeEach(() => {
    subscriptionsBuilder = mkBuilder({ id: 1, source_type: 'group', consensus_rule: 'max' });
    groupMemberBuilder = mkBuilder({ id: 99 }); // 模擬 caller 已是 member
  });

  it('成員設定 target → 200 + action=target-set', async () => {
    const res = await POST(
      mkReq({ action: 'set-target', userId: 'Uabc', target: 13500 }),
      mkParams('1')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe('target-set');
  });

  it('還不是 member → 403 (要先 join)', async () => {
    // 兩種「沒 member」情境都要回 403：
    // (1) member-check select 回 null
    // (2) member-check select 回 undefined
    groupMemberBuilder = mkBuilder(null);
    const res = await POST(
      mkReq({ action: 'set-target', userId: 'Uxyz', target: 13500 }),
      mkParams('1')
    );
    expect(res.status).toBe(403);
  });

  it('target=null (清掉表態) → 仍接受', async () => {
    const res = await POST(
      mkReq({ action: 'set-target', userId: 'Uabc', target: null }),
      mkParams('1')
    );
    expect(res.status).toBe(200);
  });

  it('target=-100 (負數) → zod 擋 400', async () => {
    const res = await POST(
      mkReq({ action: 'set-target', userId: 'Uabc', target: -100 }),
      mkParams('1')
    );
    expect(res.status).toBe(400);
  });

  it('個人訂閱不能 set-target → 400', async () => {
    subscriptionsBuilder = mkBuilder({ id: 99, source_type: 'user', consensus_rule: 'max' });
    const res = await POST(
      mkReq({ action: 'set-target', userId: 'Uabc', target: 13500 }),
      mkParams('99')
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/group-watch/[id] (G2 expanded)', () => {
  beforeEach(() => {
    subscriptionsBuilder = mkBuilder({ consensus_rule: 'max', max_price: 18000 });
    groupMemberBuilder = mkBuilder([
      { line_user_id: 'Uabc', display_name: 'Alice', accepted_target: 12000, joined_at: '2026-06-01' },
      { line_user_id: 'Uxyz', display_name: 'Bob',   accepted_target: 18000, joined_at: '2026-06-02' }
    ]);
  });

  it('回 members + consensusRule + derivedTarget', async () => {
    const res = await GET(mkReq(), mkParams('1'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.members).toHaveLength(2);
    expect(body.consensusRule).toBe('max');
    expect(body.derivedTarget).toBe(18000);
  });
});
