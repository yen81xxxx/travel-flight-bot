/**
 * Airline whitelist + 分類（廉航 LCC / 全服務 Full-service）。
 * 任何航空公司名稱包含這些關鍵字的航班才會被列出。
 */

export type AirlineCategory = 'lcc' | 'full-service';

interface AirlineEntry {
  category: AirlineCategory;
  displayName: string;
  // nameKeywords：用全名比對，避免 'British' 裡的 'it' 被誤判成虎航
  nameKeywords: string[];
  // codeKeywords：兩字母代碼，只放在 whitelist 撈航班用，不參與顯示名/分類判斷
  codeKeywords: string[];
}

const AIRLINES: AirlineEntry[] = [
  { category: 'full-service', displayName: '星宇航空', nameKeywords: ['星宇', 'Starlux'], codeKeywords: ['JX'] },
  { category: 'full-service', displayName: '長榮航空', nameKeywords: ['長榮', 'EVA'],     codeKeywords: ['BR'] },
  { category: 'lcc',          displayName: '台灣虎航', nameKeywords: ['虎航', 'Tigerair'],codeKeywords: ['IT'] },
  { category: 'lcc',          displayName: '捷星',     nameKeywords: ['捷星', 'Jetstar'], codeKeywords: ['GK'] },
  { category: 'lcc',          displayName: '酷航',     nameKeywords: ['酷航', 'Scoot'],   codeKeywords: ['TR'] }
];

export const AIRLINE_KEYWORDS: string[] = AIRLINES.flatMap(a => [...a.nameKeywords, ...a.codeKeywords]);

/**
 * 判斷某個航班的航空公司是否在 whitelist 內。
 * 不分大小寫、子字串比對；含 2-letter code 比對以最大化覆蓋率。
 */
export function isWhitelistedAirline(airline: string | null | undefined): boolean {
  if (!airline) return false;
  const lower = airline.toLowerCase();
  return AIRLINE_KEYWORDS.some(k => lower.includes(k.toLowerCase()));
}

/**
 * 取得航空公司的分類（LCC 或 Full-service）；不在 whitelist 內回 null。
 * 只比對全名關鍵字，避免 'British' 裡的 'it' 被誤判。
 */
export function getAirlineCategory(airline: string | null | undefined): AirlineCategory | null {
  return matchByName(airline)?.category ?? null;
}

/**
 * 顯示用的中文航空公司名稱對應（從原始 SerpApi 字串標準化）。
 * 只比對全名關鍵字，避免誤判。
 */
export function normalizeAirlineName(airline: string): string {
  return matchByName(airline)?.displayName ?? airline;
}

/**
 * 取得某個分類所有航空公司的 IATA code（給 Skyscanner deep-link 的 oa/ia 參數用）。
 * 例：getAirlineCodesByCategory('lcc') → ['IT', 'GK', 'TR']
 */
export function getAirlineCodesByCategory(category: AirlineCategory): string[] {
  return AIRLINES
    .filter(a => a.category === category)
    .flatMap(a => a.codeKeywords);
}

function matchByName(airline: string | null | undefined): AirlineEntry | null {
  if (!airline) return null;
  const lower = airline.toLowerCase();
  for (const entry of AIRLINES) {
    if (entry.nameKeywords.some(k => lower.includes(k.toLowerCase()))) return entry;
  }
  return null;
}
