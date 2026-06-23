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
  // 起飛時段窗口過濾 — 'HH:MM' 字串，NULL 表該方向不限
  // min = 不早於、max = 不晚於；可同時設兩端，也可只設其中一端
  // 例：去程 min='12:00' = 排除 12:00 之前起飛；max='18:00' = 排除 18:00 之後起飛
  outbound_min_departure_time?: string | null;
  return_min_departure_time?: string | null;
  outbound_max_departure_time?: string | null;
  return_max_departure_time?: string | null;
  currency: string;
  active: boolean;
  paused?: boolean;
  last_notified_at?: string | null;
  last_notified_price?: number | null;
  label?: string | null;
  created_at?: string;
  // G0: 群組共識規則。只有 source_type='group' 訂閱才用，個人訂閱忽略此欄位
  consensus_rule?: 'max' | 'avg' | 'manual' | null;
  // G0: 建立者 LINE userId — 紀錄用，**不**控制權限（group watch 沒 owner）
  created_by_user_id?: string | null;
  // 航司過濾（migration 0012）：只在這些航司裡找最便宜。存 displayName
  // （'星宇航空' / '捷星'…）。null / 空 = 不過濾，等同追全部白名單航司（舊行為）。
  airline_filter?: string[] | null;
  // #5 (migration 0011): 群組訂閱建立者的「原始門檻」基準。
  // 共識把 derived 寫進 max_price 會蓋掉原值；當全員離開 / 沒人設目標（derived=null）
  // 時還原到這個基準，而不是卡在最後一次的共識值。個人訂閱忽略。
  base_max_price?: number | null;
  // 釘選航班（migration 0013 單選 → 0014 複選，方案 B）：只追這幾班。
  //   pinned_flight_numbers：比對 key 陣列（班號，例 ['GK 13','IT 201']）
  //   pinned_flight_labels ：顯示快照陣列（例 ['捷星 · 08:30','台灣虎航 · 11:25']）
  // null / 空 = 沒釘選，照舊追整條線。有值時忽略 airline_filter / 時段過濾。
  pinned_flight_numbers?: string[] | null;
  pinned_flight_labels?: string[] | null;
  // @deprecated 0013 單選欄（DB 還在、不刪；程式改讀 *_numbers 陣列）
  pinned_flight_number?: string | null;
  pinned_flight_label?: string | null;
}

/** G0: 群組成員（subscriptions: id 1 → N）。個人訂閱永遠 0 筆。*/
export interface GroupMember {
  id?: number;
  subscription_id: number;
  line_user_id: string;
  display_name: string | null;
  /** 該成員自己能接受的價格上限，null = 跟著 derived target、不影響共識 */
  accepted_target: number | null;
  joined_at?: string;
}

/** G0: 群組日期候選（G3 用，G0 先上 schema） */
export interface DateOption {
  id?: number;
  subscription_id: number;
  out_date: string;        // YYYY-MM-DD
  ret_date: string | null; // YYYY-MM-DD 或 null = 該選項是單程
  created_at?: string;
}

/** G0: 群組日期投票（G3 用）*/
export interface DateVote {
  id?: number;
  date_option_id: number;
  subscription_id: number;
  line_user_id: string;
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
