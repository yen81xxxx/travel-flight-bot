/**
 * 數據轉換對象（DTO）和轉換工具
 */

import type { FlightQuote, Subscription } from '@/types';

/**
 * 航班報價 DTO（用於 API 響應）
 */
export interface FlightQuoteDTO {
  origin: string;
  destination: string;
  airline: string | null;
  price: number | null;
  duration: string;
  stops: number;
  directFlight: boolean;
}

/**
 * 訂閱信息 DTO
 */
export interface SubscriptionDTO {
  id: number;
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  thresholdPrice: number;
  active: boolean;
}

/**
 * 搜尋結果 DTO
 */
export interface SearchResultDTO {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  cheapestOutbound: FlightQuoteDTO | null;
  cheapestReturn: FlightQuoteDTO | null;
  cheapestPrice: number | null;
  fromCache: boolean;
}

/**
 * 將飛行分鐘轉換為可讀格式
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins > 0 ? `${mins}m` : ''}`;
}

/**
 * 將 FlightQuote 轉換為 FlightQuoteDTO
 */
export function toFlightQuoteDTO(quote: FlightQuote): FlightQuoteDTO {
  return {
    origin: quote.origin,
    destination: quote.destination,
    airline: quote.airline,
    price: quote.price,
    duration: quote.duration_minutes ? formatDuration(quote.duration_minutes) : 'N/A',
    stops: quote.stops,
    directFlight: quote.stops === 0
  };
}

/**
 * 將 Subscription 轉換為 SubscriptionDTO
 */
export function toSubscriptionDTO(sub: Subscription): SubscriptionDTO {
  if (!sub.id) {
    throw new Error('Subscription must have an id to convert to DTO');
  }
  return {
    id: sub.id,
    origin: sub.origin,
    destination: sub.destination,
    outboundDate: sub.outbound_date || '',
    returnDate: sub.return_date || '',
    thresholdPrice: sub.max_price,
    active: sub.active
  };
}

/**
 * 格式化價格為本地格式
 */
export function formatPrice(price: number | null, currency = 'TWD'): string {
  if (price === null) return 'N/A';
  return `${currency} ${price.toLocaleString()}`;
}

/**
 * 日期格式化（YYYY-MM-DD 轉為相對日期或完整日期）
 */
export function formatDate(dateStr: string, relative = false): string {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (relative) {
    const diff = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';
    if (diff > 0) return `${diff} 天後`;
    if (diff < 0) return `${Math.abs(diff)} 天前`;
  }

  return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * 批量轉換 FlightQuote 陣列
 */
export function toFlightQuoteDTOs(quotes: FlightQuote[]): FlightQuoteDTO[] {
  return quotes.map(toFlightQuoteDTO);
}

/**
 * 批量轉換 Subscription 陣列
 */
export function toSubscriptionDTOs(subs: Subscription[]): SubscriptionDTO[] {
  return subs.map(toSubscriptionDTO);
}
