// ============================================
// Domain types
// ============================================

export type TripLeg = 'outbound' | 'return';
export type FlightType = 'best' | 'other';

export interface FlightQuote {
  id?: number;
  origin: string;
  destination: string;
  outbound_date: string;       // ISO date YYYY-MM-DD
  return_date: string | null;
  airline: string | null;
  airline_code: string | null;
  price: number | null;
  currency: string;
  duration_minutes: number | null;
  stops: number;
  flight_type: FlightType;
  trip_leg: TripLeg;
  raw?: unknown;
  queried_at?: string;
}

export interface ConversationState {
  source_id: string;
  state: 'idle' | 'waiting_date';
  context: {
    last_search?: {
      origin: string;
      destination: string;
      outbound_date: string;
      return_date: string;
    };
  };
  updated_at?: string;
}

export type SourceType = 'user' | 'group' | 'room';

export interface Subscription {
  id?: number;
  source_id: string;
  source_type: SourceType;
  origin: string;
  destination: string;
  outbound_date: string | null;
  return_date: string | null;
  max_price: number;                       // 主目標價（廉航 + 預設套兩類）
  max_price_traditional?: number | null;   // 傳統航空另設（null = 跟隨 max_price）
  currency: string;
  active: boolean;
  paused?: boolean;
  last_notified_at?: string | null;
  last_notified_price?: number | null;
  label?: string | null;
  created_at?: string;
}

export interface NotificationSettings {
  source_id: string;
  quiet_start: string | null;  // HH:MM
  quiet_end: string | null;    // HH:MM
  timezone: string;
  updated_at?: string;
}

// ============================================
// SerpApi response (subset of fields we use)
// ============================================

export interface SerpApiFlightLeg {
  airline: string;
  airline_logo?: string;
  flight_number?: string;
  departure_airport: { id: string; name?: string; time?: string };
  arrival_airport: { id: string; name?: string; time?: string };
  duration?: number;
  airplane?: string;
}

export interface SerpApiFlight {
  flights: SerpApiFlightLeg[];
  total_duration?: number;
  price?: number;
  type?: string;
  airline_logo?: string;
  departure_token?: string;
  booking_token?: string;
}

export interface SerpApiFlightsResponse {
  search_metadata?: { id?: string; status?: string };
  search_parameters?: Record<string, unknown>;
  best_flights?: SerpApiFlight[];
  other_flights?: SerpApiFlight[];
  price_insights?: {
    lowest_price?: number;
    price_level?: string;
    typical_price_range?: [number, number];
  };
}
