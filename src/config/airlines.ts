/**
 * Airline whitelist — 從 N8N「建立 HTML」節點搬來的篩選邏輯。
 * 任何航空公司名稱包含這些關鍵字的航班才會被列出。
 */
export const AIRLINE_KEYWORDS: string[] = [
  '星宇',     // Starlux
  'Starlux',
  'JX',
  '長榮',     // EVA Air
  'EVA',
  'BR',
  '虎航',     // Tigerair
  'Tigerair',
  'IT',
  '捷星',     // Jetstar
  'Jetstar',
  'GK',
  'Scoot',    // Scoot
  '酷航'
];

/**
 * 判斷某個航班的航空公司是否在 whitelist 內。
 * 不分大小寫、子字串比對。
 */
export function isWhitelistedAirline(airline: string | null | undefined): boolean {
  if (!airline) return false;
  const lower = airline.toLowerCase();
  return AIRLINE_KEYWORDS.some(k => lower.includes(k.toLowerCase()));
}

/**
 * 顯示用的中文航空公司名稱對應（從原始 SerpApi 字串標準化）
 */
export function normalizeAirlineName(airline: string): string {
  const lower = airline.toLowerCase();
  if (lower.includes('starlux') || lower.includes('星宇')) return '星宇航空';
  if (lower.includes('eva')     || lower.includes('長榮')) return '長榮航空';
  if (lower.includes('tigerair')|| lower.includes('虎航')) return '台灣虎航';
  if (lower.includes('jetstar') || lower.includes('捷星')) return '捷星';
  if (lower.includes('scoot')   || lower.includes('酷航')) return '酷航';
  return airline;
}
