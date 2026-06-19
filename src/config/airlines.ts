/**
 * 航空公司分類（廉航 LCC / 全服務 Full-service）+ 顯示名標準化。
 *
 * ⚠️ 這不再是「儲存白名單」。2026-06-18 起 serpapi 儲存層不再用航司白名單過濾
 *    （改成「有直飛就存」），所以任何航空都會進 flight_quotes、出現在航司勾選清單。
 *    本表的角色是：(1) 標準化顯示名（SerpApi 原始字串 → 中文）
 *                  (2) 廉航 / 傳統 分類（卡片兩列、各自目標價、currentBest 計算）
 *    沒列在這裡的航空 = 照樣被追蹤 + 可勾選，但沒有廉/傳標籤、不驅動 currentBest。
 *    → 台日線實際在飛的航空都要列在這，新航線冒出新航司再補。
 */

export type AirlineCategory = 'lcc' | 'full-service';

interface AirlineEntry {
  category: AirlineCategory;
  displayName: string;
  // nameKeywords：用全名比對，避免子字串誤判（例如 'British' 裡的 'it'、'Air China' 不該中 'China Airlines'）
  nameKeywords: string[];
  // codeKeywords：兩字母代碼，歷史上 whitelist 撈航班用；現已不參與儲存過濾/顯示名/分類
  codeKeywords: string[];
}

// 台北 ↔ 東京（及台日航線）實際有直飛的航空都列在這。
// 順序 = 航司勾選清單的預設顯示順序。
const AIRLINES: AirlineEntry[] = [
  { category: 'full-service', displayName: '星宇航空', nameKeywords: ['星宇', 'Starlux'],        codeKeywords: ['JX'] },
  { category: 'full-service', displayName: '長榮航空', nameKeywords: ['長榮', 'EVA'],            codeKeywords: ['BR'] },
  { category: 'lcc',          displayName: '捷星',     nameKeywords: ['捷星', 'Jetstar'],        codeKeywords: ['GK'] },
  { category: 'lcc',          displayName: '酷航',     nameKeywords: ['酷航', 'Scoot'],          codeKeywords: ['TR'] },
  // 2026-06-18 補：台日線其餘實際在飛的航空（無白名單後才會出現在資料裡）
  { category: 'full-service', displayName: '中華航空', nameKeywords: ['中華航空', 'China Airlines'], codeKeywords: ['CI'] },
  { category: 'full-service', displayName: '日本航空', nameKeywords: ['日本航空', 'Japan Airlines'], codeKeywords: ['JL'] },
  { category: 'full-service', displayName: '全日空',   nameKeywords: ['全日空', 'All Nippon'],   codeKeywords: ['NH'] },
  { category: 'lcc',          displayName: '台灣虎航', nameKeywords: ['台灣虎航', '虎航', 'Tigerair'], codeKeywords: ['IT'] },
  { category: 'lcc',          displayName: '樂桃',     nameKeywords: ['樂桃', 'Peach'],          codeKeywords: ['MM'] },
  // 2026-06-19 補：第五航權直飛 NRT-TPE（實際資料驗證過 SL395 / CX451 皆單段直飛 ~250min）
  { category: 'lcc',          displayName: '泰國獅航', nameKeywords: ['泰國獅航', 'Thai Lion'],  codeKeywords: ['SL'] },
  { category: 'full-service', displayName: '國泰航空', nameKeywords: ['國泰', 'Cathay'],         codeKeywords: ['CX'] }
];

/** 已分類航司的顯示名（UI 預設全選 + 這條線無資料時的 fallback）。 */
export const ALL_AIRLINE_NAMES: string[] = AIRLINES.map(a => a.displayName);

/**
 * 航班是否通過「航司過濾」。
 * filter 為空 / null / undefined → 不過濾（全部通過，等同舊行為）。
 * 比對用 normalizeAirlineName：已分類 → displayName；未分類 → 原始名。
 * 跟存進 subscriptions.airline_filter / route-airlines 回傳的值對齊（兩邊都是 normalize 後的名），
 * 所以連未分類的冷門航空（用原始名存進 filter）也能正確比對。
 */
export function matchesAirlineFilter(
  airline: string | null | undefined,
  filter: string[] | null | undefined
): boolean {
  if (!filter || filter.length === 0) return true;
  if (!airline) return false;
  return filter.includes(normalizeAirlineName(airline));
}

/**
 * 取得航空公司的分類（LCC 或 Full-service）；未分類（不在本表）回 null。
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
 * 例：getAirlineCodesByCategory('lcc') → ['GK', 'TR']
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
