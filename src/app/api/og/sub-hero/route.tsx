import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

/**
 * 動態 OG 圖：給 LINE Flex Hero 用。
 * 依目的地城市套不同漸層 + emoji，疊上路線/價格/航司文字。
 *
 * Query params:
 *   o  = origin IATA (e.g. TPE)
 *   d  = destination IATA (e.g. HND)
 *   p  = price (optional)
 *   a  = airline name (optional)
 *
 * 範例：/api/og/sub-hero?o=TPE&d=HND&p=13414&a=台灣虎航
 */

const CITY_GRADIENTS: Record<string, [string, string]> = {
  HND: ['#1e3a8a', '#7c3aed'],  // 東京 — 都會夜景藍紫
  NRT: ['#1e3a8a', '#7c3aed'],
  SDJ: ['#14532d', '#15803d'],  // 仙台 — 杜之都森林綠
  KIX: ['#9a3412', '#ea580c'],  // 大阪 — 食道樂橘紅
  ITM: ['#9a3412', '#ea580c'],
  CTS: ['#0c4a6e', '#0284c7'],  // 札幌 — 雪國冰藍
  NGO: ['#374151', '#6b7280'],  // 名古屋 — 工業灰銀
  FUK: ['#7c2d12', '#dc2626'],  // 福岡 — 博多紅
  OKA: ['#155e75', '#06b6d4'],  // 那霸 — 沖繩海藍
  TPE: ['#9a3412', '#f97316'],  // 桃園/台北 — 夕陽橘
  KHH: ['#0891b2', '#0e7490'],  // 高雄 — 港都青
  TSA: ['#9a3412', '#f97316'],
  RMQ: ['#7c2d12', '#a16207']   // 台中 — 中部金黃
};

const CITY_LABELS: Record<string, string> = {
  HND: '東京', NRT: '東京', SDJ: '仙台', KIX: '大阪', ITM: '大阪',
  CTS: '札幌', NGO: '名古屋', FUK: '福岡', OKA: '那霸',
  TPE: '桃園', KHH: '高雄', TSA: '台北', RMQ: '台中'
};

const CITY_EMOJIS: Record<string, string> = {
  HND: '🗼', NRT: '🗼', SDJ: '🌳', KIX: '🏯', ITM: '🏯',
  CTS: '❄️', NGO: '🏭', FUK: '🍜', OKA: '🌊',
  TPE: '🏙', KHH: '🌊', TSA: '🏙', RMQ: '🌾'
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const origin = (sp.get('o') ?? 'TPE').toUpperCase();
  const destination = (sp.get('d') ?? 'HND').toUpperCase();
  const price = sp.get('p');
  const airline = sp.get('a') ?? '';

  const grad = CITY_GRADIENTS[destination] ?? ['#1a2238', '#0a0e1a'];
  const emoji = CITY_EMOJIS[destination] ?? '✈️';
  const originLabel = CITY_LABELS[origin] ?? origin;
  const destLabel = CITY_LABELS[destination] ?? destination;
  const priceNum = price ? parseInt(price, 10) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: `linear-gradient(135deg, ${grad[0]} 0%, ${grad[1]} 100%)`,
          padding: '40px 50px',
          color: 'white',
          fontFamily: 'sans-serif',
          position: 'relative'
        }}
      >
        {/* 右上角大 emoji 當裝飾 */}
        <div
          style={{
            position: 'absolute',
            top: 20,
            right: 30,
            fontSize: 160,
            opacity: 0.25,
            display: 'flex'
          }}
        >
          {emoji}
        </div>

        {/* 左上：路線 */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 32, opacity: 0.85, letterSpacing: 2, display: 'flex' }}>
            {origin} → {destination}
          </div>
          <div style={{ fontSize: 64, fontWeight: 800, marginTop: 4, display: 'flex' }}>
            {originLabel} → {destLabel}
          </div>
        </div>

        {/* 左下：價格 + 航司 */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {priceNum != null ? (
            <>
              <div style={{ fontSize: 26, opacity: 0.7, display: 'flex' }}>最低</div>
              <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 4 }}>
                <div style={{ fontSize: 36, fontWeight: 600, marginRight: 12 }}>NT$</div>
                <div style={{ fontSize: 96, fontWeight: 900, letterSpacing: -2 }}>
                  {priceNum.toLocaleString()}
                </div>
              </div>
              {airline && (
                <div style={{ fontSize: 28, opacity: 0.85, marginTop: 6, display: 'flex' }}>
                  {airline}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 48, fontWeight: 600, opacity: 0.7, display: 'flex' }}>
              今日機票
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 628,
      headers: {
        // 1 小時 CDN cache（同 origin/dest/price 同樣的圖）
        'cache-control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
      }
    }
  );
}
