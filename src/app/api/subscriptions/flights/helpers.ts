/**
 * /api/subscriptions/flights 的純函數 helpers — 抽出來才不會被 Next.js
 * route validator 擋掉（App Router 的 route.ts 只允許 export GET/POST/dynamic
 * /runtime 等特定 name，自訂 export 會 build fail）。
 *
 * 同時也方便單測：route.ts 走 @jest-environment node，這個檔可以普通 jsdom 跑。
 */
import type { FlightQuote, SerpApiFlight } from '@/types';

export interface FlightRow {
  airline: string | null;
  airline_code: string | null;
  price: number | null;
  duration_minutes: number | null;
  stops: number;
  /** 'HH:MM' — 從 raw.flights[0].departure_airport.time 抽出 */
  departure_time: string | null;
  /** 第一段班機編號 (例：'JX 802') */
  flight_number: string | null;
}

/**
 * 從 flight_quotes.raw 抽 departure_time + flight_number。
 * raw 是 SerpApiFlight 結構（不一定有），所以全程防呆。
 * raw.flights[0].departure_airport.time = 'YYYY-MM-DD HH:MM' (inspect-time-format 驗過)。
 */
export function extractDisplayFields(raw: unknown): {
  departure_time: string | null;
  flight_number: string | null;
} {
  if (!raw || typeof raw !== 'object') return { departure_time: null, flight_number: null };
  const f = raw as Partial<SerpApiFlight>;
  const first = f.flights?.[0];
  if (!first) return { departure_time: null, flight_number: null };
  const t = first.departure_airport?.time;
  const departure_time = t && typeof t === 'string' && t.length >= 16 ? t.slice(11, 16) : null;
  const flight_number = first.flight_number ?? null;
  return { departure_time, flight_number };
}

export function toFlightRow(q: FlightQuote): FlightRow {
  const { departure_time, flight_number } = extractDisplayFields(q.raw);
  return {
    airline: q.airline,
    airline_code: q.airline_code,
    price: q.price,
    duration_minutes: q.duration_minutes,
    stops: q.stops,
    departure_time,
    flight_number
  };
}
