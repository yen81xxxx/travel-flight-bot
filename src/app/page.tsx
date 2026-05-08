import { getSupabase } from '@/lib/supabase';
import { analyzeFlights } from '@/lib/flights';
import type { FlightQuote } from '@/types';

// 每次請求都重新從 DB 讀（後續可改回 ISR + on-demand revalidate 提升效能）
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageData {
  origin: string;
  destination: string;
  outboundDate: string | null;
  returnDate: string | null;
  outbound: FlightQuote[];
  ret: FlightQuote[];
  lastUpdate: string | null;
}

async function loadLatest(): Promise<PageData> {
  const supabase = getSupabase();
  const origin = process.env.DEFAULT_ORIGIN ?? 'TPE';
  const destination = process.env.DEFAULT_DESTINATION ?? 'HND';

  // 找最近一次成功的搜尋
  const { data: lastRun } = await supabase
    .from('search_runs')
    .select('outbound_date, return_date, finished_at')
    .eq('origin', origin)
    .eq('destination', destination)
    .in('status', ['success', 'cached'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastRun) {
    return {
      origin,
      destination,
      outboundDate: null,
      returnDate: null,
      outbound: [],
      ret: [],
      lastUpdate: null
    };
  }

  // 拿這個日期區間的所有 quotes（取最新一批）
  let quotesQuery = supabase
    .from('flight_quotes')
    .select('*')
    .eq('origin', origin)
    .eq('destination', destination)
    .eq('outbound_date', lastRun.outbound_date)
    .order('queried_at', { ascending: false })
    .limit(200);

  if (lastRun.return_date) {
    quotesQuery = quotesQuery.eq('return_date', lastRun.return_date);
  } else {
    quotesQuery = quotesQuery.is('return_date', null);
  }

  const { data: quotes } = await quotesQuery;

  const all = (quotes ?? []) as FlightQuote[];

  return {
    origin,
    destination,
    outboundDate: lastRun.outbound_date,
    returnDate: lastRun.return_date,
    outbound: all.filter(q => q.trip_leg === 'outbound'),
    ret: all.filter(q => q.trip_leg === 'return'),
    lastUpdate: lastRun.finished_at
  };
}

export default async function HomePage() {
  const data = await loadLatest();
  const analysis = analyzeFlights(data.outbound, data.ret);
  const fmt = (n: number | null | undefined) =>
    n != null ? `NT$ ${n.toLocaleString()}` : '—';

  const sortedOutbound = [...data.outbound].sort(
    (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
  );
  const sortedReturn = [...data.ret].sort(
    (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
  );

  return (
    <main>
      <header>
        <h1>✈️ {data.origin} → {data.destination}</h1>
        <p className="sub">
          {data.outboundDate && data.returnDate
            ? `去程 ${data.outboundDate}　回程 ${data.returnDate}`
            : '尚無資料'}
          {data.lastUpdate && (
            <>　・　更新時間 {new Date(data.lastUpdate).toLocaleString('zh-TW')}</>
          )}
        </p>
      </header>

      {data.outbound.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 18, marginBottom: 8 }}>還沒有資料</div>
          <div>排程啟動後此頁會自動填入。可手動觸發 <code>/api/cron/daily-search</code></div>
        </div>
      ) : (
        <>
          <div className="summary-grid">
            <div className="card">
              <h3>最便宜往返</h3>
              <div className="value accent">
                {fmt(analysis.cheapestRoundTripPrice)}
              </div>
            </div>
            <div className="card">
              <h3>主推航空</h3>
              <div className="value">{analysis.cheapestAirline ?? '—'}</div>
            </div>
            <div className="card">
              <h3>去程候選</h3>
              <div className="value">{analysis.outboundCount}</div>
            </div>
            <div className="card">
              <h3>回程候選</h3>
              <div className="value">{analysis.returnCount}</div>
            </div>
          </div>

          <div className="section-title">去程</div>
          <FlightTable rows={sortedOutbound} />

          {sortedReturn.length > 0 && (
            <>
              <div className="section-title">回程</div>
              <FlightTable rows={sortedReturn} />
            </>
          )}
        </>
      )}

      <footer>
        資料來源：SerpApi (Google Flights) ・ 每日自動更新 ・
        透過 LINE Bot 輸入「查航班」可即時查詢自訂日期
      </footer>
    </main>
  );
}

function FlightTable({ rows }: { rows: FlightQuote[] }) {
  if (rows.length === 0) return null;
  const cheapestPrice = rows[0]?.price;
  const fmt = (n: number | null | undefined) =>
    n != null ? `NT$ ${n.toLocaleString()}` : '—';
  const fmtDuration = (m: number | null | undefined) => {
    if (m == null) return '—';
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h}h${min ? min + 'm' : ''}`;
  };
  return (
    <table>
      <thead>
        <tr>
          <th>航空</th>
          <th>票價</th>
          <th>時長</th>
          <th>轉機</th>
          <th>類型</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.airline ?? '—'}</td>
            <td>
              {fmt(r.price)}
              {r.price === cheapestPrice && (
                <>　<span className="tag cheapest">最低</span></>
              )}
            </td>
            <td>{fmtDuration(r.duration_minutes)}</td>
            <td>{r.stops === 0 ? '直飛' : `${r.stops} 次轉機`}</td>
            <td><span className="tag">{r.flight_type === 'best' ? '推薦' : '其他'}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
