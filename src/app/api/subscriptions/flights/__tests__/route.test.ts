/**
 * @jest-environment node
 *
 * /api/subscriptions/flights — integration test (mock supabase)
 *
 * 1. 缺 query param → 400
 * 2. 空結果 → ok=true, outbound=[], return=[]
 * 3. 同時有 outbound + return → 分兩 array、各自按 price 排序
 * 4. extractDisplayFields 純函數：抽 departure_time + flight_number
 * 5. raw 結構壞 → 不 throw、回 null
 */
import { GET } from '../route';
import { extractDisplayFields } from '../helpers';

interface MockResult { data: unknown[] | null; error: { message: string } | null }
interface MockBuilder {
  data: unknown[] | null;
  error: { message: string } | null;
  select: jest.Mock; eq: jest.Mock; in: jest.Mock; is: jest.Mock; gte: jest.Mock; not: jest.Mock;
  then: (resolve: (r: MockResult) => unknown) => Promise<unknown>;
}
const mkBuilder = (data: unknown[] | null, error: MockBuilder['error'] = null): MockBuilder => {
  const self: MockBuilder = {
    data, error,
    select: jest.fn(() => self), eq: jest.fn(() => self), in: jest.fn(() => self),
    is: jest.fn(() => self), gte: jest.fn(() => self), not: jest.fn(() => self),
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

describe('extractDisplayFields — 純函數', () => {
  it('正常 raw → 抽出 HH:MM + flight_number', () => {
    const raw = {
      flights: [{
        airline: '酷航',
        departure_airport: { id: 'TPE', time: '2026-08-14 14:30' },
        arrival_airport: { id: 'NRT', time: '2026-08-14 18:45' },
        flight_number: 'TR 887'
      }]
    };
    expect(extractDisplayFields(raw)).toEqual({
      departure_time: '14:30',
      flight_number: 'TR 887'
    });
  });

  it('raw=null → 全 null', () => {
    expect(extractDisplayFields(null)).toEqual({ departure_time: null, flight_number: null });
  });

  it('raw 沒 flights array → 全 null（不 throw）', () => {
    expect(extractDisplayFields({})).toEqual({ departure_time: null, flight_number: null });
  });

  it('flights[0] departure_airport.time 格式短 → departure_time=null', () => {
    expect(extractDisplayFields({ flights: [{ departure_airport: { time: 'bad' } }] }))
      .toEqual({ departure_time: null, flight_number: null });
  });

  it('沒 flight_number 但有 time → 只 flight_number=null', () => {
    expect(extractDisplayFields({
      flights: [{ departure_airport: { time: '2026-08-14 09:05' } }]
    })).toEqual({ departure_time: '09:05', flight_number: null });
  });
});

describe('GET /api/subscriptions/flights', () => {
  beforeEach(() => { fromImpl = () => mkBuilder([]); });

  it('缺 origin → 400', async () => {
    const res = await GET(mkReq('destination=NRT&outboundDate=2026-08-14'));
    expect(res.status).toBe(400);
  });

  it('缺 destination → 400', async () => {
    const res = await GET(mkReq('origin=TPE&outboundDate=2026-08-14'));
    expect(res.status).toBe(400);
  });

  it('缺 outboundDate → 400', async () => {
    const res = await GET(mkReq('origin=TPE&destination=NRT'));
    expect(res.status).toBe(400);
  });

  it('空快取 → ok=true + outbound/return 都是空 array', async () => {
    const res = await GET(mkReq('origin=TPE&destination=NRT&outboundDate=2026-08-14&returnDate=2026-08-18'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.outbound).toEqual([]);
    expect(body.return).toEqual([]);
  });

  it('混合 outbound + return → 分兩 array，各自按 price 升序', async () => {
    fromImpl = () => mkBuilder([
      { trip_leg: 'outbound', price: 13000, airline: 'X', stops: 0, raw: null },
      { trip_leg: 'outbound', price: 11500, airline: 'Y', stops: 0, raw: null },
      { trip_leg: 'return',   price: 14000, airline: 'Z', stops: 0, raw: null },
      { trip_leg: 'return',   price: 11000, airline: 'W', stops: 0, raw: null }
    ]);
    const res = await GET(mkReq('origin=TPE&destination=NRT&outboundDate=2026-08-14&returnDate=2026-08-18'));
    const body = await res.json();
    expect(body.outbound.map((r: { price: number }) => r.price)).toEqual([11500, 13000]);
    expect(body.return.map((r: { price: number }) => r.price)).toEqual([11000, 14000]);
  });

  it('DB error → 500', async () => {
    fromImpl = () => mkBuilder(null, { message: 'oops' });
    const res = await GET(mkReq('origin=TPE&destination=NRT&outboundDate=2026-08-14'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('oops');
  });

  it('沒 returnDate → 單程模式（API 仍回 outbound + return=[]）', async () => {
    fromImpl = () => mkBuilder([
      { trip_leg: 'outbound', price: 9500, airline: 'A', stops: 0, raw: null }
    ]);
    const res = await GET(mkReq('origin=TPE&destination=NRT&outboundDate=2026-08-14'));
    const body = await res.json();
    expect(body.outbound).toHaveLength(1);
    expect(body.return).toEqual([]);
  });

  it('完整 raw → row 含 departure_time + flight_number', async () => {
    fromImpl = () => mkBuilder([{
      trip_leg: 'outbound', price: 11500, airline: '酷航', airline_code: 'TR',
      stops: 0, duration_minutes: 180,
      raw: { flights: [{ departure_airport: { id: 'TPE', time: '2026-08-14 09:30' }, flight_number: 'TR 887' }] }
    }]);
    const res = await GET(mkReq('origin=TPE&destination=NRT&outboundDate=2026-08-14&returnDate=2026-08-18'));
    const body = await res.json();
    expect(body.outbound[0].departure_time).toBe('09:30');
    expect(body.outbound[0].flight_number).toBe('TR 887');
  });
});
