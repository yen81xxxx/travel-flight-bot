import { getSupabase } from '@/lib/supabase';
import { analyzeFlights } from '@/lib/flights';
import { formatAirport } from '@/config/airports';
import type { FlightQuote } from '@/types';

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
      origin, destination,
      outboundDate: null, returnDate: null,
      outbound: [], ret: [], lastUpdate: null
    };
  }

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
    origin, destination,
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

  const fmtTime = (s: string) => new Date(s).toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  return (
    <main>
      <section className="hero">
        <div className="route">
          <span>✈️</span>
          <span>{formatAirport(data.origin)}</span>
          <span className="arrow">→</span>
          <span>{formatAirport(data.destination)}</span>
        </div>
        <h1>每日機票看板</h1>
        <p className="meta">
          {data.outboundDate && data.returnDate ? (
            <>📅 {data.outboundDate} ~ {data.returnDate}</>
          ) : (
            <>還沒有資料，等排程跑起來</>
          )}
          {data.lastUpdate && <> 　・　🕒 更新於 {fmtTime(data.lastUpdate)}</>}
        </p>
      </section>

      {data.outbound.length === 0 ? (
        <div className="empty">
          <div className="icon">🌙</div>
          <div className="title">尚未有資料</div>
          <div className="desc">
            排程啟動後此頁會自動填入。可手動觸發 <code>/api/cron/daily-search</code>
          </div>
        </div>
      ) : (
        <>
          <div className="summary-grid">
            <div className="card">
              <div className="label">💰 最便宜往返</div>
              <div className="value accent">
                {fmt(analysis.cheapestRoundTripPrice)}
              </div>
            </div>
            <div className="card">
              <div className="label">🏢 主推航空</div>
              <div className="value">{analysis.cheapestAirline ?? '—'}</div>
            </div>
            <div className="card">
              <div className="label">🛫 去程候選</div>
              <div className="value">{analysis.outboundCount}</div>
              <div className="sub">符合篩選的航班</div>
            </div>
            <div className="card">
              <div className="label">🛬 回程候選</div>
              <div className="value">{analysis.returnCount}</div>
              <div className="sub">符合篩選的航班</div>
            </div>
          </div>

          <div className="section-title">
            🛫 去程
            <span className="badge">{sortedOutbound.length} 班次</span>
          </div>
          <FlightTable rows={sortedOutbound} />

          {sortedReturn.length > 0 && (
            <>
              <div className="section-title">
                🛬 回程
                <span className="badge">{sortedReturn.length} 班次</span>
              </div>
              <FlightTable rows={sortedReturn} />
            </>
          )}
        </>
      )}

      <section className="bot-cta">
        <div className="cta-grid">
          <div>
            <div className="cta-eyebrow">🤖 LINE Bot</div>
            <h2 className="cta-title">陽明小助手</h2>
            <p className="cta-desc">
              加為好友 → 對它說「<strong>查航班</strong>」就能：
            </p>
            <ul className="cta-list">
              <li>✈️ 即時查任意航線票價（4 個台灣機場 → 28 個日本機場）</li>
              <li>🔔 訂閱降價提醒，跌破門檻自動 LINE 通知</li>
              <li>📅 多組日期同時追蹤</li>
              <li>📊 看歷史價格走勢、找最划算時段</li>
            </ul>
            <a className="cta-button" href={`https://line.me/R/ti/p/@${process.env.LINE_BASIC_ID ?? '024fxtan'}`}>
              ➕ 加好友
            </a>
            <a className="cta-button secondary" href="/liff/search" style={{ marginLeft: 8 }}>
              🔍 直接查機票
            </a>
          </div>
          <div className="qr-wrap">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&bgcolor=1a2238&color=ffffff&qzone=2&data=${encodeURIComponent('https://line.me/R/ti/p/@' + (process.env.LINE_BASIC_ID ?? '024fxtan'))}`}
              alt="LINE 加好友 QR Code"
              className="qr"
            />
            <div className="qr-caption">手機掃描加好友</div>
          </div>
        </div>
      </section>

      <footer>
        資料來源 SerpApi (Google Flights) ・ 每日自動更新
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
    <div className="flight-list">
      {rows.map((r, i) => (
        <div key={i} className="flight-row">
          <div className="airline">{r.airline ?? '—'}</div>
          <div>
            {r.flight_type === 'best' && (
              <span className="tag recommended">推薦</span>
            )}
            {r.price === cheapestPrice && (
              <span className="tag cheapest" style={{ marginLeft: 6 }}>最低</span>
            )}
          </div>
          <div className="duration">⏱ {fmtDuration(r.duration_minutes)}</div>
          <div className={`stops ${r.stops === 0 ? 'direct' : ''}`}>
            {r.stops === 0 ? '✦ 直飛' : `${r.stops} 次轉機`}
          </div>
          <div className="price">{fmt(r.price)}</div>
        </div>
      ))}
    </div>
  );
}
