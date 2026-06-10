/**
 * @jest-environment node
 *
 * /api/group-watch/[id]/poll — date option / vote endpoints
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
    maybeSingle: jest.fn(() => {
      if (Array.isArray(data)) return Promise.resolve({ data: data[0] ?? null, error });
      return Promise.resolve({ data, error });
    }),
    then: (resolve) => {
      const out = Array.isArray(data) ? data : (data == null ? [] : [data]);
      return Promise.resolve(resolve({ data: out, error }));
    }
  };
  return self;
};

const builders = {
  subscriptions: mkBuilder({ id: 1, source_type: 'group' }),
  date_option: mkBuilder([]),
  date_vote: mkBuilder([]),
  group_member: mkBuilder({ id: 99 })  // caller 已是 member
};

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const b = (builders as Record<string, MockBuilder>)[table];
      if (!b) throw new Error('unexpected table: ' + table);
      return b;
    }
  })
}));

const mkReq = (search = '', body?: object) =>
  ({
    json: () => Promise.resolve(body),
    url: `http://localhost/api/group-watch/1/poll${search}`,
    nextUrl: { searchParams: new URLSearchParams(search.replace(/^\?/, '')) }
  }) as unknown as Parameters<typeof POST>[0];

const mkParams = (id: string) => ({ params: { id } });

describe('GET /api/group-watch/[id]/poll', () => {
  beforeEach(() => {
    builders.subscriptions = mkBuilder({ id: 1, source_type: 'group' });
    builders.date_option = mkBuilder([]);
    builders.date_vote = mkBuilder([]);
    builders.group_member = mkBuilder([]);
  });

  it('invalid id → 400', async () => {
    const res = await GET(mkReq(), mkParams('NaN'));
    expect(res.status).toBe(400);
  });

  it('沒選項 → 空 options[]、myVote=null', async () => {
    const res = await GET(mkReq(), mkParams('1'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.options).toEqual([]);
    expect(body.myVote).toBeNull();
  });

  it('有選項 + 票 → voters / voteCount / myVote 都對', async () => {
    builders.date_option = mkBuilder([
      { id: 10, out_date: '2026-08-14', ret_date: '2026-08-18', created_at: '2026-06-01' },
      { id: 11, out_date: '2026-08-21', ret_date: '2026-08-25', created_at: '2026-06-02' }
    ]);
    builders.date_vote = mkBuilder([
      { date_option_id: 10, line_user_id: 'Uabc' },
      { date_option_id: 10, line_user_id: 'Uxyz' },
      { date_option_id: 11, line_user_id: 'Uqqq' }
    ]);
    builders.group_member = mkBuilder([
      { line_user_id: 'Uabc', display_name: 'Alice' },
      { line_user_id: 'Uxyz', display_name: 'Bob' },
      { line_user_id: 'Uqqq', display_name: 'Carol' }
    ]);

    const res = await GET(mkReq('?userId=Uabc'), mkParams('1'));
    const body = await res.json();
    expect(body.options).toHaveLength(2);

    const opt10 = body.options.find((o: { id: number }) => o.id === 10);
    expect(opt10.voteCount).toBe(2);
    expect(opt10.voters.map((v: { line_user_id: string }) => v.line_user_id).sort()).toEqual(['Uabc', 'Uxyz']);
    expect(opt10.voters.find((v: { line_user_id: string }) => v.line_user_id === 'Uabc').display_name).toBe('Alice');

    const opt11 = body.options.find((o: { id: number }) => o.id === 11);
    expect(opt11.voteCount).toBe(1);

    // myVote 推算 — Uabc 投了 10
    expect(body.myVote).toBe(10);
  });

  it('caller 沒投票 → myVote=null', async () => {
    builders.date_vote = mkBuilder([
      { date_option_id: 10, line_user_id: 'Uxyz' }
    ]);
    const res = await GET(mkReq('?userId=Uabc'), mkParams('1'));
    const body = await res.json();
    expect(body.myVote).toBeNull();
  });
});

describe('POST /api/group-watch/[id]/poll — add-option', () => {
  beforeEach(() => {
    builders.subscriptions = mkBuilder({ id: 1, source_type: 'group' });
    builders.date_option = mkBuilder({ id: 100 });
    builders.group_member = mkBuilder({ id: 99 });
  });

  it('正常 add-option → 200 + optionId', async () => {
    const res = await POST(mkReq('', {
      action: 'add-option', userId: 'Uabc', outDate: '2026-08-14', retDate: '2026-08-18'
    }), mkParams('1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('option-added');
    expect(body.optionId).toBe(100);
  });

  it('沒 outDate → 400', async () => {
    const res = await POST(mkReq('', {
      action: 'add-option', userId: 'Uabc'
    }), mkParams('1'));
    expect(res.status).toBe(400);
  });

  it('outDate 格式錯誤 → 400', async () => {
    const res = await POST(mkReq('', {
      action: 'add-option', userId: 'Uabc', outDate: 'garbage'
    }), mkParams('1'));
    expect(res.status).toBe(400);
  });

  it('還不是 member → 403', async () => {
    builders.group_member = mkBuilder(null);
    const res = await POST(mkReq('', {
      action: 'add-option', userId: 'Uxxx', outDate: '2026-08-14'
    }), mkParams('1'));
    expect(res.status).toBe(403);
  });

  it('個人訂閱 → 400', async () => {
    builders.subscriptions = mkBuilder({ id: 99, source_type: 'user' });
    const res = await POST(mkReq('', {
      action: 'add-option', userId: 'Uabc', outDate: '2026-08-14'
    }), mkParams('99'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/group-watch/[id]/poll — vote', () => {
  beforeEach(() => {
    builders.subscriptions = mkBuilder({ id: 1, source_type: 'group' });
    builders.group_member = mkBuilder({ id: 99 });
    builders.date_option = mkBuilder({ id: 10, subscription_id: 1 });
    builders.date_vote = mkBuilder([]);
  });

  it('正常 vote → 200', async () => {
    const res = await POST(mkReq('', {
      action: 'vote', userId: 'Uabc', optionId: 10
    }), mkParams('1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('voted');
    expect(builders.date_vote.upsert).toHaveBeenCalled();
  });

  it('沒 optionId → 400', async () => {
    const res = await POST(mkReq('', {
      action: 'vote', userId: 'Uabc'
    }), mkParams('1'));
    expect(res.status).toBe(400);
  });

  it('option 不屬於這個 sub → 400 (防跨 sub 亂投)', async () => {
    builders.date_option = mkBuilder({ id: 999, subscription_id: 5 });  // 不同 sub
    const res = await POST(mkReq('', {
      action: 'vote', userId: 'Uabc', optionId: 999
    }), mkParams('1'));
    expect(res.status).toBe(400);
  });

  it('option 不存在 → 400', async () => {
    builders.date_option = mkBuilder(null);
    const res = await POST(mkReq('', {
      action: 'vote', userId: 'Uabc', optionId: 9999
    }), mkParams('1'));
    expect(res.status).toBe(400);
  });

  it('還不是 member → 403', async () => {
    builders.group_member = mkBuilder(null);
    const res = await POST(mkReq('', {
      action: 'vote', userId: 'Uxxx', optionId: 10
    }), mkParams('1'));
    expect(res.status).toBe(403);
  });

  it('正常 vote → upsert by (subscription_id, line_user_id) 覆蓋舊投', async () => {
    await POST(mkReq('', { action: 'vote', userId: 'Uabc', optionId: 10 }), mkParams('1'));
    // upsert 第二參數需含 onConflict subscription_id,line_user_id
    const upsertArgs = builders.date_vote.upsert.mock.calls[0];
    expect(upsertArgs[1].onConflict).toBe('subscription_id,line_user_id');
    expect(upsertArgs[1].ignoreDuplicates).toBe(false);
  });
});

describe('POST /api/group-watch/[id]/poll — remove-option', () => {
  beforeEach(() => {
    builders.subscriptions = mkBuilder({ id: 1, source_type: 'group' });
    builders.group_member = mkBuilder({ id: 99 });
    builders.date_option = mkBuilder({ id: 10, subscription_id: 1 });
  });

  it('正常 remove → 200 + delete called', async () => {
    const res = await POST(mkReq('', {
      action: 'remove-option', userId: 'Uabc', optionId: 10
    }), mkParams('1'));
    expect(res.status).toBe(200);
    expect(builders.date_option.delete).toHaveBeenCalled();
  });

  it('option 不存在 → 404', async () => {
    builders.date_option = mkBuilder(null);
    const res = await POST(mkReq('', {
      action: 'remove-option', userId: 'Uabc', optionId: 9999
    }), mkParams('1'));
    expect(res.status).toBe(404);
  });

  it('option 屬於別的 sub → 404', async () => {
    builders.date_option = mkBuilder({ id: 999, subscription_id: 5 });
    const res = await POST(mkReq('', {
      action: 'remove-option', userId: 'Uabc', optionId: 999
    }), mkParams('1'));
    expect(res.status).toBe(404);
  });
});
