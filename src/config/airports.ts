/**
 * 機場清單：台灣出發地 + 日本目的地
 * 只列「實際有從台灣直飛或主流轉機的日本機場」
 */

export interface Airport {
  iata: string;
  name: string;          // 中文名
  city: string;          // 城市
  region?: string;       // 地區（北/中/西/東/九州/沖繩等）
}

// 台灣出發機場（國際航線）
export const TW_ORIGINS: Airport[] = [
  { iata: 'TPE', name: '桃園國際機場',  city: '桃園' },
  { iata: 'KHH', name: '高雄國際機場',  city: '高雄' },
  { iata: 'RMQ', name: '台中清泉崗機場', city: '台中' },
  { iata: 'TSA', name: '松山機場',      city: '台北' }
];

// 日本目的地機場（從台灣有航班的）
export const JP_DESTINATIONS: Airport[] = [
  // 關東
  { iata: 'HND', name: '羽田機場',     city: '東京', region: '關東' },
  { iata: 'NRT', name: '成田機場',     city: '東京', region: '關東' },
  { iata: 'IBR', name: '茨城機場',     city: '茨城', region: '關東' },

  // 關西
  { iata: 'KIX', name: '關西國際機場', city: '大阪', region: '關西' },

  // 中部
  { iata: 'NGO', name: '中部國際機場', city: '名古屋', region: '中部' },
  { iata: 'KMQ', name: '小松機場',     city: '金澤',   region: '中部' },
  { iata: 'TOY', name: '富山機場',     city: '富山',   region: '中部' },
  { iata: 'FSZ', name: '靜岡機場',     city: '靜岡',   region: '中部' },

  // 北海道
  { iata: 'CTS', name: '新千歲機場',   city: '札幌',   region: '北海道' },
  { iata: 'HKD', name: '函館機場',     city: '函館',   region: '北海道' },
  { iata: 'AKJ', name: '旭川機場',     city: '旭川',   region: '北海道' },

  // 東北
  { iata: 'SDJ', name: '仙台機場',     city: '仙台',   region: '東北' },
  { iata: 'AOJ', name: '青森機場',     city: '青森',   region: '東北' },
  { iata: 'AXT', name: '秋田機場',     city: '秋田',   region: '東北' },
  { iata: 'HNA', name: '花卷機場',     city: '盛岡',   region: '東北' },

  // 中國 / 四國
  { iata: 'HIJ', name: '廣島機場',     city: '廣島',   region: '中國' },
  { iata: 'OKJ', name: '岡山機場',     city: '岡山',   region: '中國' },
  { iata: 'TAK', name: '高松機場',     city: '高松',   region: '四國' },
  { iata: 'MYJ', name: '松山機場',     city: '松山',   region: '四國' },

  // 九州
  { iata: 'FUK', name: '福岡機場',     city: '福岡',   region: '九州' },
  { iata: 'KMI', name: '宮崎機場',     city: '宮崎',   region: '九州' },
  { iata: 'KOJ', name: '鹿兒島機場',   city: '鹿兒島', region: '九州' },
  { iata: 'KMJ', name: '熊本機場',     city: '熊本',   region: '九州' },
  { iata: 'OIT', name: '大分機場',     city: '大分',   region: '九州' },

  // 沖繩
  { iata: 'OKA', name: '那霸機場',     city: '那霸',   region: '沖繩' },
  { iata: 'ISG', name: '石垣機場',     city: '石垣島', region: '沖繩' },
  { iata: 'MMY', name: '宮古機場',     city: '宮古島', region: '沖繩' }
];

/**
 * 把日本機場依地區分組（給 UI 用）
 */
export function groupJpByRegion(): Record<string, Airport[]> {
  const groups: Record<string, Airport[]> = {};
  for (const ap of JP_DESTINATIONS) {
    const r = ap.region ?? '其他';
    (groups[r] = groups[r] ?? []).push(ap);
  }
  return groups;
}

/** 判斷機場是否在台灣 */
export function isTaiwanAirport(iata: string): boolean {
  return TW_ORIGINS.some(a => a.iata === iata);
}

/** 判斷機場是否在日本 */
export function isJapanAirport(iata: string): boolean {
  return JP_DESTINATIONS.some(a => a.iata === iata);
}

/** 全部支援的機場（台灣 + 日本） */
export const ALL_AIRPORTS: Airport[] = [...TW_ORIGINS, ...JP_DESTINATIONS];

/**
 * 用 IATA 代碼找機場資訊
 */
export function getAirport(iata: string): Airport | undefined {
  return [...TW_ORIGINS, ...JP_DESTINATIONS].find(a => a.iata === iata);
}

/**
 * 顯示用的字串：「東京 (HND)」
 */
export function formatAirport(iata: string): string {
  const ap = getAirport(iata);
  if (!ap) return iata;
  return `${ap.city} (${iata})`;
}
