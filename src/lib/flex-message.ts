import { formatAirport, getCity, getCityAirports } from '@/config/airports';
import { getAirlineCodesByCategory, type AirlineCategory } from '@/config/airlines';
import type { Verdict } from '@/app/liff/_lib/priceIntel';

/* ============================================================
   L1 — 推播卡深色設計語言（LINE_SURFACE_SPEC §A）
   Flex JSON 不認 CSS var，這裡用跟 tokens.css :root 同值的 hex。
   LINE Flex 支援 #RRGGBBAA — tint 背景跟 LIFF 的 rgba 同語言。
   ============================================================ */
export const FLEX_DARK = {
  cardBg: '#1b1b1f',
  text: '#ffffff',
  soft: '#ebebf599',   // ≈ rgba(235,235,245,0.6)
  faint: '#ebebf54d',  // ≈ rgba(235,235,245,0.3)
  green: '#30d158',
  greenTint: '#30d15820',
  red: '#ff453a',
  blue: '#0a84ff',
  cyan: '#64d2ff',
  cyanTint: '#64d2ff26',
  yellow: '#ffd60a',
  yellowTint: '#ffd60a2e',
  barDim: '#3a3a3e'
} as const;

/** verdict → 推播 badge 的字面 + 配色（與 LIFF VerdictBadge 同語意、hex 版） */
export const VERDICT_FLEX_META: Record<Verdict, { label: string; fg: string; bg: string }> = {
  'buy':      { label: '建議入手', fg: '#06351a', bg: '#30d158' },
  'lean-buy': { label: '可考慮',   fg: '#06283a', bg: '#64d2ff' },
  'watch':    { label: '觀察中',   fg: '#ffffff', bg: '#3a3a3e' },
  'wait':     { label: '建議再等', fg: '#3a2102', bg: '#ff9f0a' }
};

/** 推播卡的航司顯示列 — sub-checker 從 analyzeFlights 結果導出後傳進來 */
export interface CarrierDisplay {
  tag: 'lcc' | 'trad' | null;
  line: string;
}

/**
 * 從 analyzeFlights 的兩類結果導出 carrier 顯示（純函數）。
 * 規則同 quote-builder currentBest：取較便宜者、同價優先 LCC。
 */
export function deriveCarrierDisplay(
  lccCombo: { outboundAirline: string; returnAirline: string; price: number } | null,
  traditionalRoundTrip: { airline: string; price: number } | null,
  fallbackAirline: string | null
): CarrierDisplay | null {
  if (lccCombo && (!traditionalRoundTrip || lccCombo.price <= traditionalRoundTrip.price)) {
    const line = lccCombo.outboundAirline === lccCombo.returnAirline
      ? lccCombo.outboundAirline
      : `${lccCombo.outboundAirline} → ${lccCombo.returnAirline}`;
    return { tag: 'lcc', line };
  }
  if (traditionalRoundTrip) {
    return { tag: 'trad', line: `${traditionalRoundTrip.airline}・同家來回` };
  }
  if (fallbackAirline) return { tag: null, line: fallbackAirline };
  return null;
}

interface AlertFlexProps {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string | null;  // null = 單程訂閱
  cheapestPrice: number;
  threshold: number;
  airline: string;
  // 這條訂閱的 source_id（user 或 group）。給「我的訂閱」按鈕帶 ctx 用，
  // 不傳就 fallback 到普通連結（個人訂閱情境）
  sourceId?: string;
  // === L1 新增（全部 optional — 拿不到就降級、推播照發） ===
  /** priceIntel verdict（與 LIFF 同引擎算出）；null/undefined = 不顯示 badge */
  verdict?: Verdict | null;
  /** 週變化 %（負 = 跌）；null = 藏 delta */
  deltaPct?: number | null;
  /** 30 天每日最低（升冪）— mini 歷史 bars；空 = 藏 */
  dailyMins?: number[];
  /** 航司顯示列（deriveCarrierDisplay 的輸出）；null = 退回 airline 字串 */
  carrier?: CarrierDisplay | null;
}

/** dailyMins → Flex mini bars（stacked box 模擬 sparkline — Flex 沒有 SVG） */
export function buildMiniBars(dailyMins: number[]): object | null {
  if (dailyMins.length < 2) return null;
  const bars = dailyMins.slice(-14);
  const lo = Math.min(...bars);
  const hi = Math.max(...bars);
  const span = hi - lo || 1;
  return {
    type: 'box',
    layout: 'horizontal',
    height: '28px',
    spacing: '3px',
    alignItems: 'flex-end',
    margin: 'md',
    contents: bars.map((p, i) => ({
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'filler' }],
      // 價格越低 bar 越矮（跟 LIFF sparkline 同向：高度 = 價格）
      height: `${Math.round(8 + ((p - lo) / span) * 20)}px`,
      backgroundColor: i === bars.length - 1 ? FLEX_DARK.green : FLEX_DARK.barDim,
      cornerRadius: '2px',
      flex: 1
    }))
  };
}

/** 顯示日期區間的小工具：來回顯示 'YYYY-MM-DD ~ YYYY-MM-DD'，單程顯示 '單程 YYYY-MM-DD' */
function formatDateRange(outboundDate: string, returnDate: string | null | undefined): string {
  return returnDate ? `📅 ${outboundDate} ~ ${returnDate}` : `📅 單程 ${outboundDate}`;
}

interface TraditionalRoundTripData {
  airline: string;
  price: number;
  /** 此價格對應的目的地機場 IATA（例：'NRT'）。多機場城市時用來標示「傳統 (NRT)」 */
  airport?: string;
}

interface LccComboData {
  outboundAirline: string;
  returnAirline: string;
  price: number;
  airport?: string;
}

interface DailyFlexProps {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string | null;  // null = 單程
  cheapestPrice: number | null;
  cheapestAirline: string | null;
  // 卡片主體顯示這兩列：
  // - 傳統航空（星宇/長榮）同家來回最低
  // - 廉航（虎航/捷星/酷航）去 + 回最便宜組合（可不同家）
  traditionalRoundTrip?: TraditionalRoundTripData | null;
  lccCombo?: LccComboData | null;
  // 跟「昨天」（2-36h 前）同分類最低相比的百分比變化。
  // 正數 = 今天比較貴（漲），負數 = 今天比較便宜（跌），null = 沒有歷史可比。
  // 顯示在分類列航司 label 旁邊：「台灣虎航 往返·HND  ↓8%」
  lccVsPrevPct?: number | null;
  tradVsPrevPct?: number | null;
  // 資料來自快取時的 ISO timestamp（快取被寫入的時間）。
  // 有值 → 卡片底部會加 "(抓 HH:mm 的快取)" 提醒；null/undefined → 不顯示。
  cachedAt?: string | null;
  // 如果這張 card 是給某個訂閱者看的，帶上他的門檻和 source_id：
  // - threshold：顯示「你的門檻 NT$ X，目前 ±Y%」
  // - sourceId：footer 多一顆「我的訂閱」按鈕（群組會帶 ctx）
  threshold?: number;
  sourceId?: string;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://travel-flight-bot.vercel.app';

/**
 * 價格達標提醒 Flex Message — L1 深色版（LINE_SURFACE_SPEC §A2）
 *
 * 設計語言對齊 LIFF：深色卡 #1b1b1f、零 emoji、verdict badge（同
 * priceIntel 引擎）、tabular 價格、mini 歷史 bars、主 CTA 留在 Travl
 *（看走勢與航班），Skyscanner 是次要 ghost（產品決議：convenience link）。
 *
 * 所有 L1 新欄位 optional — intel 撈不到就少 badge/delta/bars，推播照發。
 */
export function buildAlertFlex(props: AlertFlexProps) {
  const drop = props.threshold - props.cheapestPrice;
  const dropPct = Math.round((drop / props.threshold) * 100);
  // 邊界情況：降幅 < 1%（例如只差 NT$ 8）寫「低 0%」看起來像 bug
  // → 改寫成「達到目標價」語氣（沿用舊卡的處理，文案换新）
  const isAtThreshold = dropPct < 1;
  const targetLine = isAtThreshold
    ? `達到你的目標價 NT$${props.threshold.toLocaleString()}（便宜 NT$${drop.toLocaleString()}）`
    : `已跌破你的目標價 NT$${props.threshold.toLocaleString()}（低 NT$${drop.toLocaleString()}）`;

  const verdictMeta = props.verdict ? VERDICT_FLEX_META[props.verdict] : null;

  // delta：負 = 跌（綠 ▼）、正 = 漲（紅 ▲）。|Δ| < 0.05 視為持平不顯示。
  const delta = props.deltaPct != null && Math.abs(props.deltaPct) >= 0.05
    ? {
        type: 'text',
        text: `${props.deltaPct < 0 ? '▼' : '▲'} ${Math.abs(props.deltaPct)}%`,
        size: 'sm',
        weight: 'bold',
        color: props.deltaPct < 0 ? FLEX_DARK.green : FLEX_DARK.red,
        flex: 0,
        gravity: 'bottom'
      }
    : null;

  const bars = props.dailyMins ? buildMiniBars(props.dailyMins) : null;

  // carrier 列：tag pill（廉航青 / 傳統黃）+ 航司字串
  const carrier = props.carrier ?? (props.airline ? { tag: null, line: props.airline } : null);
  const carrierRow = carrier
    ? {
        type: 'box',
        layout: 'baseline',
        margin: 'md',
        spacing: 'sm',
        contents: [
          ...(carrier.tag
            ? [{
                type: 'text',
                text: carrier.tag === 'lcc' ? '廉航' : '傳統',
                size: 'xxs',
                weight: 'bold',
                color: carrier.tag === 'lcc' ? FLEX_DARK.cyan : FLEX_DARK.yellow,
                flex: 0
              }]
            : []),
          {
            type: 'text',
            text: carrier.line,
            size: 'xs',
            color: FLEX_DARK.soft,
            wrap: true
          }
        ]
      }
    : null;

  const verdictSuffix = verdictMeta ? `（${verdictMeta.label}）` : '';
  return {
    type: 'flex',
    altText: `價格達標：${props.origin} → ${props.destination} NT$${props.cheapestPrice.toLocaleString()}${verdictSuffix}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      // hero strip：綠 tint 上「價格達標」+ verdict badge（spec §A2）
      header: {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        contents: [
          {
            type: 'text',
            text: '價格達標',
            weight: 'bold',
            size: 'sm',
            color: FLEX_DARK.green,
            flex: 1
          },
          ...(verdictMeta
            ? [{
                type: 'box',
                layout: 'vertical',
                flex: 0,
                backgroundColor: verdictMeta.bg,
                cornerRadius: '999px',
                paddingAll: '4px',
                paddingStart: '10px',
                paddingEnd: '10px',
                contents: [
                  {
                    type: 'text',
                    text: verdictMeta.label,
                    size: 'xxs',
                    weight: 'bold',
                    color: verdictMeta.fg
                  }
                ]
              }]
            : [])
        ],
        backgroundColor: '#102818',
        paddingAll: '12px',
        paddingStart: '16px',
        paddingEnd: '12px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: FLEX_DARK.cardBg,
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: `${getCity(props.origin)} → ${getCity(props.destination)}`,
            weight: 'bold',
            size: 'lg',
            color: FLEX_DARK.text,
            wrap: true
          },
          {
            type: 'text',
            text: `${props.origin} → ${props.destination}・${props.returnDate ? `${props.outboundDate} ~ ${props.returnDate}` : `單程 ${props.outboundDate}`}`,
            size: 'xs',
            color: FLEX_DARK.faint,
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'lg',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: '目前最低',
                    size: 'xxs',
                    color: FLEX_DARK.faint
                  },
                  {
                    type: 'box',
                    layout: 'baseline',
                    contents: [
                      {
                        type: 'text',
                        text: 'NT$',
                        size: 'sm',
                        color: FLEX_DARK.soft,
                        flex: 0
                      },
                      {
                        type: 'text',
                        text: props.cheapestPrice.toLocaleString(),
                        weight: 'bold',
                        size: '3xl',
                        color: FLEX_DARK.text,
                        margin: 'sm',
                        flex: 0
                      }
                    ]
                  }
                ]
              },
              ...(delta ? [delta] : [])
            ]
          },
          ...(bars ? [bars] : []),
          ...(carrierRow ? [carrierRow] : []),
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            backgroundColor: FLEX_DARK.greenTint,
            cornerRadius: '8px',
            paddingAll: '10px',
            contents: [
              {
                type: 'text',
                text: targetLine,
                size: 'xs',
                color: FLEX_DARK.green,
                wrap: true
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        backgroundColor: FLEX_DARK.cardBg,
        paddingAll: '16px',
        paddingTop: '0px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: FLEX_DARK.blue,
            height: 'sm',
            action: {
              type: 'uri',
              label: '看走勢與航班',
              uri: subscriptionsUrlFor(props.sourceId)
            }
          },
          {
            // Skyscanner = 次要 ghost（產品決議：convenience、永遠排在 in-app CTA 下面）
            type: 'button',
            style: 'link',
            height: 'sm',
            action: {
              type: 'uri',
              label: '用 Skyscanner 訂',
              uri: flightSearchUrl(props)
            }
          }
        ]
      },
      styles: {
        header: { separator: false },
        body: { separator: false }
      }
    }
  };
}

/**
 * 每日排程 broadcast Flex Message
 */
export function buildDailyFlex(props: DailyFlexProps) {
  const priceText = props.cheapestPrice != null
    ? `NT$ ${props.cheapestPrice.toLocaleString()}`
    : '無資料';

  // 主價格顏色：有門檻 + 已跌破 → 綠（好消息）；否則維持橘
  let priceColor = '#ff7a45';
  if (props.threshold != null && props.cheapestPrice != null && props.cheapestPrice <= props.threshold) {
    priceColor = '#22c55e';
  }

  // 跟門檻的對比行（只有訂閱者才有）
  const compareLine: Record<string, unknown> | null =
    props.threshold != null && props.cheapestPrice != null
      ? (() => {
          const diff = props.cheapestPrice! - props.threshold!;
          const diffPct = Math.round((diff / props.threshold!) * 100);
          const isBelow = diff <= 0;
          const sign = isBelow ? '低' : '高';
          const color = isBelow ? '#22c55e' : '#94a3b8';
          // 寫「比門檻」清楚是跟門檻比，不是跟昨天的價比（跟昨天的比在分類列上的 ↓/↑ 後綴）
          return {
            type: 'text',
            text: `🎯 你的門檻 NT$ ${props.threshold!.toLocaleString()}（目前比門檻${sign} ${Math.abs(diffPct)}%）`,
            size: 'xs',
            color,
            margin: 'sm',
            wrap: true
          } as Record<string, unknown>;
        })()
      : null;

  // 多機場城市（東京）的 header 只顯示城市名（不帶 IATA），每列再標自己的機場
  const destLabel = getCityAirports(props.destination).length > 1
    ? getCity(props.destination)
    : formatAirport(props.destination);

  const body: Record<string, unknown>[] = [
    {
      type: 'text',
      text: `${formatAirport(props.origin)} → ${destLabel}`,
      weight: 'bold',
      size: 'md',
      wrap: true
    },
    {
      type: 'text',
      text: formatDateRange(props.outboundDate, props.returnDate),
      size: 'sm',
      color: '#666666'
    },
    { type: 'separator', margin: 'md' },
    lccRow(props.lccCombo, priceColor, props.origin, props.destination, props.outboundDate, props.returnDate, props.lccVsPrevPct),
    traditionalRow(props.traditionalRoundTrip, priceColor, props.origin, props.destination, props.outboundDate, props.returnDate, props.tradVsPrevPct)
  ];
  // 註：lccRow / traditionalRow 內部會優先用 data.airport（多機場時跨機場挑最便宜的）覆寫 destination
  if (compareLine) body.push(compareLine);
  const cacheHint = props.cachedAt ? `（抓 ${formatTaipeiHmFromIso(props.cachedAt)} 的快取）` : '';
  body.push({
    type: 'text',
    text: `🕐 ${formatTaipeiHm()} 更新${cacheHint}`,
    size: 'xs',
    color: '#94a3b8',
    margin: 'md',
    align: 'end',
    wrap: true
  });

  // Footer：訂閱者只需要「我的訂閱」按鈕；Skyscanner 入口改成 body 兩列各自可點
  const footerButtons: Record<string, unknown>[] = [];
  if (props.sourceId) {
    footerButtons.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: '📋 我的訂閱',
        uri: subscriptionsUrlFor(props.sourceId)
      }
    });
  } else {
    // 沒訂閱的 fallback（保留原本「查其他航線」）
    footerButtons.push({
      type: 'button',
      style: 'primary',
      color: '#ff7a45',
      height: 'sm',
      action: {
        type: 'message',
        label: '🔍 查其他航線',
        text: '查航班'
      }
    });
  }

  return {
    type: 'flex',
    altText: `今日 ${formatAirport(props.origin)} → ${formatAirport(props.destination)} 最低 ${priceText}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '✈️ 今日機票',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff'
          }
        ],
        backgroundColor: '#1a2238',
        paddingAll: '16px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: body
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: footerButtons
      }
    }
  };
}

/**
 * 多訂閱總表卡：一個 source 一張卡，列出所有訂閱（每訂閱一段，可點去 Skyscanner）。
 * 取代「每個 source 只發最近一筆」的去重邏輯。
 */
/**
 * 為何「沒有 cheapestPrice」— 用來在卡片上區分系統問題 vs 真的沒航班
 *   'quota-exhausted' → SerpApi key 配額全用完，這次沒查到（不是路線本身有問題）
 *   undefined / null  → 正常查詢但 SerpApi 沒回任何符合白名單的航班（路線/日期問題）
 */
export type ItemErrorReason = 'quota-exhausted';

export interface MultiSubsItem {
  origin: string;
  destination: string;           // 訂閱原始 dest（可能 HND，多機場時 cheapestAirport 會帶實際勝出機場）
  outboundDate: string;
  returnDate: string | null;     // null = 單程訂閱
  maxPrice: number;              // 主目標價（廉航 + 傳統的 fallback）
  maxPriceTraditional?: number | null;  // 傳統航空另設目標價（null = 跟隨 maxPrice）
  label?: string | null;
  // 跨類最低（用來決定 hero 圖、目標價比較、預設 footer 動作）
  cheapestPrice: number | null;
  cheapestAirport: string | null;
  cheapestCategory: 'lcc' | 'full-service' | null;
  cheapestAirline: string | null;
  vsPrevPct: number | null;
  errorReason?: ItemErrorReason | null;  // 沒 cheapestPrice 時的原因（系統問題 vs 真的沒航班）
  // 廉航分類詳細（mix-and-match 組合）
  lcc?: {
    price: number;
    airport: string;
    outboundAirline: string;
    returnAirline: string;
    vsPrevPct: number | null;
    isEstimate?: boolean;  // true → 來源是去程估算（非精確配對）
  } | null;
  // 傳統航空分類詳細（同家來回）
  traditional?: {
    price: number;
    airport: string;
    airline: string;
    vsPrevPct: number | null;
  } | null;
}

interface MultiSubsDailyFlexProps {
  items: MultiSubsItem[];
  sourceId: string;
  cachedAt?: string | null;
}

export function buildMultiSubsDailyFlex(props: MultiSubsDailyFlexProps) {
  // Carousel 上限 12 個 bubble — 1 個總覽 + 11 個訂閱（夠用）
  const overviewBubble = buildOverviewBubble(props.items.length, props.sourceId, props.cachedAt);
  const subBubbles = props.items.slice(0, 11).map(item => buildSubBubble(item, props.sourceId));

  return {
    type: 'flex',
    altText: `今日機票 ${props.items.length} 筆訂閱`,
    contents: {
      type: 'carousel',
      contents: [overviewBubble, ...subBubbles]
    }
  };
}

/** Carousel 第一張：總覽 bubble */
function buildOverviewBubble(count: number, sourceId: string, cachedAt?: string | null): Record<string, unknown> {
  const cacheHint = cachedAt ? `（抓 ${formatTaipeiHmFromIso(cachedAt)} 的快取）` : '';
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: '✈️', size: '4xl', align: 'center' },
        { type: 'text', text: '今日機票', weight: 'bold', size: 'xl', align: 'center', color: '#1a2238' },
        { type: 'text', text: `${count} 筆訂閱`, size: 'lg', align: 'center', color: '#666666' },
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: '👉 左右滑動切換各訂閱', size: 'sm', align: 'center', color: '#94a3b8', margin: 'lg', wrap: true },
        { type: 'text', text: `🕐 ${formatTaipeiHm()} 更新${cacheHint}`, size: 'xs', color: '#94a3b8', align: 'center', wrap: true }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [{
        type: 'button',
        style: 'primary',
        color: '#1a2238',
        height: 'sm',
        action: {
          type: 'uri',
          label: '📋 管理我的訂閱',
          uri: subscriptionsUrlFor(sourceId)
        }
      }]
    }
  };
}

/**
 * 卡片內單一分類段（廉航 or 傳統）：3 段組成
 *   行 1：✈️ 廉航 · 台灣虎航       NT$ 13,414
 *   行 2：   比目標價低 NT$ 9,614（40%）· 較昨日 ↓5%
 *   行 3：   [ 🛒 用 Skyscanner 訂廉航 ]   ← 各自的 Skyscanner 按鈕
 * 沒資料時行 1 顯示「— 查無」，無行 2、無按鈕
 */
function buildCategoryRowsForBubble(
  icon: string,
  label: string,
  data: MultiSubsItem['lcc'] | MultiSubsItem['traditional'] | null | undefined,
  maxPrice: number,
  origin: string,
  outboundDate: string,
  returnDate: string | null  // null = 單程訂閱
): Record<string, unknown>[] {
  if (!data) {
    return [{
      type: 'box',
      layout: 'baseline',
      margin: 'md',
      contents: [
        { type: 'text', text: `${icon} ${label}`, size: 'sm', color: '#666666', flex: 4 },
        { type: 'text', text: '— 查無', size: 'sm', color: '#cbd5e1', flex: 5, align: 'end' }
      ]
    }];
  }

  // 航司名稱：傳統就是同家、廉航 mix-and-match 簡寫成「虎航+捷星」（去掉「航空」「台灣」減字數）
  let airlineName: string;
  if ('airline' in data) {
    airlineName = data.airline;
  } else if (data.outboundAirline === data.returnAirline) {
    airlineName = data.outboundAirline;
  } else {
    const short = (s: string) => s.replace(/航空$/, '').replace(/^台灣/, '');
    airlineName = `${short(data.outboundAirline)}+${short(data.returnAirline)}`;
  }
  const labelText = `${icon} ${label} · ${airlineName}`;

  const priceColor = data.price <= maxPrice ? '#22c55e' : '#ff7a45';
  // 廉航 fallback 是「去程估算」，加 ＊ 標示提醒實際訂票價可能差幾百元
  const isEst = 'isEstimate' in data && data.isEstimate === true;
  const priceText = `NT$ ${data.price.toLocaleString()}${isEst ? '＊' : ''}`;

  // 目標價比較（per category）— 顯示目標價本身當錨點
  const diff = data.price - maxPrice;
  const diffPct = Math.round((Math.abs(diff) / maxPrice) * 100);
  const isBelow = diff <= 0;
  const diffAbs = Math.abs(diff).toLocaleString();
  const targetStr = maxPrice.toLocaleString();
  const thBase = isBelow
    ? `比目標 NT$ ${targetStr} 低 NT$ ${diffAbs}（${diffPct}%）`
    : `比目標 NT$ ${targetStr} 高 NT$ ${diffAbs}（${diffPct}%）`;
  // vs 昨日 delta 加在目標價比較行尾（變化 < 1% 不顯示）
  const deltaPct = data.vsPrevPct;
  let deltaSegment = '';
  if (deltaPct != null && Math.abs(deltaPct) >= 1) {
    deltaSegment = deltaPct < 0 ? ` · 較昨日 ↓${Math.abs(deltaPct)}%` : ` · 較昨日 ↑${deltaPct}%`;
  }
  const thColor = isBelow ? '#22c55e' : '#94a3b8';

  // Skyscanner 按鈕：依分類帶不同航司篩選
  const category: AirlineCategory = 'airline' in data ? 'full-service' : 'lcc';
  const skyscannerUrl = skyscannerUrlForCategory(category, origin, data.airport, outboundDate, returnDate);

  return [
    {
      type: 'box',
      layout: 'baseline',
      margin: 'md',
      contents: [
        { type: 'text', text: labelText, size: 'sm', color: '#666666', flex: 5, wrap: false },
        { type: 'text', text: priceText, size: 'md', weight: 'bold', color: priceColor, flex: 4, align: 'end' }
      ]
    },
    {
      type: 'text',
      text: `${thBase}${deltaSegment}`,
      size: 'xs',
      color: thColor,
      align: 'end',
      margin: 'xs',
      wrap: true
    },
    // Skyscanner 改成 iOS 風 text link，視覺輕量不跟 footer 大按鈕打架
    {
      type: 'text',
      text: '🔗 用 Skyscanner 訂 ›',
      size: 'xs',
      color: '#0a84ff',  // iOS link blue
      align: 'end',
      margin: 'xs',
      action: {
        type: 'uri',
        label: `用 Skyscanner 訂${label}`,
        uri: skyscannerUrl
      }
    }
  ];
}

/** Carousel 第 2~N 張：每筆訂閱一個 bubble（hero 動態渲染城市主題圖）*/
function buildSubBubble(item: MultiSubsItem, sourceId: string): Record<string, unknown> {
  const showAirport = item.cheapestAirport && item.cheapestAirport !== item.destination;
  const destCity = getCity(item.destination);
  const destLabel = showAirport
    ? `${destCity} (${item.cheapestAirport})`
    : formatAirport(item.destination);
  const routeText = `${formatAirport(item.origin)} → ${destLabel}`;
  // 單程：'📅 單程 02-04'；來回：'📅 02-04 ~ 04-04'
  const dateText = item.returnDate
    ? `📅 ${item.outboundDate.slice(5)} ~ ${item.returnDate.slice(5)}`
    : `📅 單程 ${item.outboundDate.slice(5)}`;

  // Header：路線 + 日期（大字一目了然，無 hero 重複問題）
  const header = {
    type: 'box',
    layout: 'vertical',
    backgroundColor: '#1c1c1e',
    paddingAll: '14px',
    contents: [
      { type: 'text', text: routeText, weight: 'bold', size: 'md', color: '#ffffff', wrap: true },
      { type: 'text', text: dateText, size: 'xs', color: '#94a3b8', margin: 'xs' }
    ]
  };

  const bodyContents: Record<string, unknown>[] = [];
  if (item.label) {
    bodyContents.push({ type: 'text', text: `📝 ${item.label}`, size: 'xs', color: '#94a3b8' });
  }

  if (item.cheapestPrice == null) {
    if (item.errorReason === 'quota-exhausted') {
      // 系統問題：橘黃色，讓人看出跟「真的沒航班」不同
      bodyContents.push(
        { type: 'text', text: '⏸ 今日查詢額度暫滿', size: 'sm', color: '#f59e0b', weight: 'bold', margin: 'sm' },
        { type: 'text', text: '明日會自動恢復查詢', size: 'xxs', color: '#94a3b8', margin: 'xs' }
      );
    } else {
      // 真的沒匹配的航班
      bodyContents.push(
        { type: 'text', text: '❌ 此條件無符合航班', size: 'sm', color: '#cbd5e1', margin: 'sm' },
        { type: 'text', text: '可試其他日期或機場', size: 'xxs', color: '#94a3b8', margin: 'xs' }
      );
    }
  } else {
    // 廉航：用主目標價 maxPrice
    bodyContents.push(...buildCategoryRowsForBubble('✈️', '廉航', item.lcc, item.maxPrice, item.origin, item.outboundDate, item.returnDate));
    // 兩段中間細分隔，視覺上分開
    bodyContents.push({ type: 'separator', margin: 'md', color: '#e5e7eb' });
    // 傳統：用 maxPriceTraditional 或 fallback 到 maxPrice
    const tradTarget = item.maxPriceTraditional ?? item.maxPrice;
    bodyContents.push(...buildCategoryRowsForBubble('✈️', '傳統', item.traditional, tradTarget, item.origin, item.outboundDate, item.returnDate));
  }

  const body = {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    contents: bodyContents
  };

  const footerContents: Record<string, unknown>[] = [];
  if (item.cheapestPrice != null && item.cheapestCategory && item.cheapestAirport) {
    // 看歷史走勢 postback — 單程訂閱 ret 給空字串（postback handler 需 decode 後再判斷）
    const histData = new URLSearchParams({
      a: 'h',
      o: item.origin,
      d: item.destination,
      out: item.outboundDate,
      ret: item.returnDate ?? '',
      max: String(item.maxPrice),
      cat: item.cheapestCategory,
      win: item.cheapestAirport
    }).toString();
    footerContents.push({
      type: 'button',
      style: 'primary',
      color: '#60a5fa',
      height: 'sm',
      action: {
        type: 'postback',
        label: '📊 看歷史走勢',
        data: histData,
        displayText: `查 ${item.origin}→${item.destination} 歷史走勢`
      }
    });
    // Skyscanner 按鈕已移到 body 內每個分類底下
    // 分享按鈕暫移除：liff.shareTargetPicker 在 LINE in-app browser 內仍判 isInClient false
    // 原因疑似 LIFF channel scope 未配置 + LIFF auth flow 在 deep link 場景不穩。
    // /liff/share 頁面保留，等之後重做時可用。
  } else {
    footerContents.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: '📋 管理訂閱',
        uri: subscriptionsUrlFor(sourceId)
      }
    });
  }

  return {
    type: 'bubble',
    size: 'kilo',
    header,
    body,
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: footerContents
    }
  };
}

/**
 * 歷史走勢卡片（postback 觸發）— 一張 LINE 內顯示的價格走勢，不開瀏覽器。
 * 同時顯示廉航 + 傳統兩條歷史線（每日各自最低），底部 Skyscanner 訂票按鈕。
 */
export interface HistoryFlexProps {
  origin: string;
  destination: string;          // 訂閱原始 dest（顯示用，例：HND）
  outboundDate: string;
  returnDate: string;
  lccPoints: { date: string; minPrice: number }[];   // 廉航每日最低（按日期升冪）
  tradPoints: { date: string; minPrice: number }[];  // 傳統每日最低（按日期升冪）
  threshold: number;
  skyscannerUrl: string;
}

export function buildHistoryFlex(props: HistoryFlexProps) {
  const { lccPoints, tradPoints, threshold, skyscannerUrl } = props;

  // 取所有出現的日期（兩分類各自最近 14 天的聯集）
  const allDates = new Set<string>();
  for (const p of lccPoints.slice(-14)) allDates.add(p.date);
  for (const p of tradPoints.slice(-14)) allDates.add(p.date);
  const dates = Array.from(allDates).sort();

  const lccByDate = new Map(lccPoints.map(p => [p.date, p.minPrice]));
  const tradByDate = new Map(tradPoints.map(p => [p.date, p.minPrice]));

  const hasAny = dates.length > 0;
  const routeText = `${formatAirport(props.origin)} → ${formatAirport(props.destination)}`;
  const dateRangeText = `📅 ${props.outboundDate} ~ ${props.returnDate}`;

  const bodyContents: Record<string, unknown>[] = [
    { type: 'text', text: routeText, weight: 'bold', size: 'md', wrap: true },
    { type: 'text', text: dateRangeText, size: 'xs', color: '#94a3b8' },
    { type: 'separator', margin: 'md' }
  ];

  if (!hasAny) {
    bodyContents.push({
      type: 'text',
      text: '📊 尚無歷史資料',
      size: 'sm',
      color: '#94a3b8',
      align: 'center',
      margin: 'md'
    });
    bodyContents.push({
      type: 'text',
      text: '再等幾天 cron 累積後就能看走勢',
      size: 'xs',
      color: '#64748b',
      align: 'center'
    });
  } else {
    // 表頭：日期 / 廉航 / 傳統
    bodyContents.push({
      type: 'box',
      layout: 'baseline',
      margin: 'md',
      contents: [
        { type: 'text', text: '日期', size: 'xs', color: '#94a3b8', flex: 2 },
        { type: 'text', text: '✈️ 廉航', size: 'xs', color: '#94a3b8', flex: 4, align: 'end' },
        { type: 'text', text: '✈️ 傳統', size: 'xs', color: '#94a3b8', flex: 4, align: 'end' }
      ]
    });
    bodyContents.push({ type: 'separator', margin: 'sm' });

    // 算 min/max 找最低/最高 highlight
    const lccPrices = lccPoints.slice(-14).map(p => p.minPrice);
    const tradPrices = tradPoints.slice(-14).map(p => p.minPrice);
    const lccMin = lccPrices.length ? Math.min(...lccPrices) : null;
    const lccMax = lccPrices.length > 1 ? Math.max(...lccPrices) : null;
    const tradMin = tradPrices.length ? Math.min(...tradPrices) : null;
    const tradMax = tradPrices.length > 1 ? Math.max(...tradPrices) : null;

    // 每日一行
    for (let i = 0; i < dates.length; i++) {
      const day = dates[i];
      const isToday = i === dates.length - 1;
      const lcc = lccByDate.get(day);
      const trad = tradByDate.get(day);

      const cellText = (p: number | undefined, min: number | null, max: number | null) => {
        if (p == null) return { text: '—', color: '#64748b' };
        const isMin = p === min && min !== max;
        const isMax = p === max && min !== max;
        const prefix = isMin ? '↓' : isMax ? '↑' : '';
        const color = isToday ? '#60a5fa' : isMin ? '#4ade80' : isMax ? '#f87171' : (p <= threshold ? '#22c55e' : '#cbd5e1');
        return { text: `${prefix}${p.toLocaleString()}`, color };
      };
      const lccCell = cellText(lcc, lccMin, lccMax);
      const tradCell = cellText(trad, tradMin, tradMax);

      const dateLabel = isToday ? `★${day.slice(5)}` : day.slice(5);
      const dateColor = isToday ? '#60a5fa' : '#94a3b8';

      bodyContents.push({
        type: 'box',
        layout: 'baseline',
        margin: 'xs',
        contents: [
          { type: 'text', text: dateLabel, size: 'xs', color: dateColor, flex: 2 },
          { type: 'text', text: lccCell.text, size: 'xs', weight: 'bold', color: lccCell.color, flex: 4, align: 'end' },
          { type: 'text', text: tradCell.text, size: 'xs', weight: 'bold', color: tradCell.color, flex: 4, align: 'end' }
        ]
      });
    }

    bodyContents.push({ type: 'separator', margin: 'md' });

    // 統計區
    if (lccMin != null) {
      const lastLcc = lccPoints[lccPoints.length - 1].minPrice;
      const lccDiff = lastLcc - threshold;
      bodyContents.push({
        type: 'text',
        text: `✈️ 廉航：今日 NT$ ${lastLcc.toLocaleString()}　|　${lccDiff <= 0 ? '比目標低' : '比目標高'} NT$ ${Math.abs(lccDiff).toLocaleString()}`,
        size: 'xs',
        color: lccDiff <= 0 ? '#22c55e' : '#94a3b8',
        wrap: true,
        margin: 'sm'
      });
    } else {
      bodyContents.push({ type: 'text', text: '✈️ 廉航：無歷史資料', size: 'xs', color: '#64748b', margin: 'sm' });
    }
    if (tradMin != null) {
      const lastTrad = tradPoints[tradPoints.length - 1].minPrice;
      const tradDiff = lastTrad - threshold;
      bodyContents.push({
        type: 'text',
        text: `✈️ 傳統：今日 NT$ ${lastTrad.toLocaleString()}　|　${tradDiff <= 0 ? '比目標低' : '比目標高'} NT$ ${Math.abs(tradDiff).toLocaleString()}`,
        size: 'xs',
        color: tradDiff <= 0 ? '#22c55e' : '#94a3b8',
        wrap: true
      });
    } else {
      bodyContents.push({ type: 'text', text: '✈️ 傳統：無歷史資料', size: 'xs', color: '#64748b' });
    }
    bodyContents.push({
      type: 'text',
      text: `🎯 目標價 NT$ ${threshold.toLocaleString()}`,
      size: 'xs',
      color: '#94a3b8',
      margin: 'sm',
      wrap: true
    });
  }

  return {
    type: 'flex',
    altText: `📊 ${routeText} 歷史價格`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📊 歷史價格走勢',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff',
            wrap: true
          }
        ],
        backgroundColor: '#1a2238',
        paddingAll: '16px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: bodyContents
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#ff7a45',
          height: 'sm',
          action: {
            type: 'uri',
            label: '🛒 用 Skyscanner 訂',
            uri: skyscannerUrl
          }
        }]
      }
    }
  };
}

/**
 * 「我的訂閱」按鈕的 URL ── 群組 source 要附 ctx 才能在 LIFF 撈到該群組的訂閱。
 */
function subscriptionsUrlFor(sourceId?: string): string {
  if (sourceId && (sourceId.startsWith('C') || sourceId.startsWith('R'))) {
    return `${APP_URL}/liff/subscriptions?ctx=${encodeURIComponent(sourceId)}`;
  }
  return `${APP_URL}/liff/subscriptions`;
}

/**
 * Skyscanner 的 deep link 比 Google Flights 可靠 —— 直接帶機場碼 + 日期到 URL path，
 * 不需要 NLP parse 就能 pre-fill 搜尋條件。日期格式是 YYMMDD。
 */
function flightSearchUrl(p: AlertFlexProps): string {
  return skyscannerUrl(p.origin, p.destination, p.outboundDate, p.returnDate);
}

/**
 * 廉航列：去 + 回可不同家。同家時顯示「虎航往返」，不同家時顯示「虎航去・捷星回」。
 * 整列可點，帶 Skyscanner 廉航直飛篩選參數。
 */
function lccRow(
  data: LccComboData | null | undefined,
  priceColor: string,
  origin: string,
  destination: string,
  outboundDate: string,
  returnDate: string | null,  // null = 單程
  vsPrevPct: number | null | undefined
): Record<string, unknown> {
  const hasData = data != null;
  const rowAirport = data?.airport ?? destination;
  const airportSuffix = airportSuffixForSecondLine(destination, rowAirport);
  const deltaSuffix = formatDeltaSuffix(vsPrevPct);
  const airlineLabel = hasData
    ? (data!.outboundAirline === data!.returnAirline
        ? `${data!.outboundAirline} 往返${airportSuffix}${deltaSuffix}`
        : `${data!.outboundAirline} 去・${data!.returnAirline} 回${airportSuffix}${deltaSuffix}`)
    : '查無';
  const uri = hasData
    ? skyscannerUrlForCategory('lcc', origin, rowAirport, outboundDate, returnDate)
    : null;
  return comboRow('✈️ 廉航', hasData ? data!.price : null, airlineLabel, priceColor, uri);
}

/**
 * 傳統列：同家來回。整列可點，帶 Skyscanner 全服務直飛篩選參數。
 */
function traditionalRow(
  data: TraditionalRoundTripData | null | undefined,
  priceColor: string,
  origin: string,
  destination: string,
  outboundDate: string,
  returnDate: string | null,  // null = 單程
  vsPrevPct: number | null | undefined
): Record<string, unknown> {
  const hasData = data != null;
  const rowAirport = data?.airport ?? destination;
  const airportSuffix = airportSuffixForSecondLine(destination, rowAirport);
  const deltaSuffix = formatDeltaSuffix(vsPrevPct);
  const airlineLabel = hasData ? `${data!.airline} 往返${airportSuffix}${deltaSuffix}` : '查無';
  const uri = hasData
    ? skyscannerUrlForCategory('full-service', origin, rowAirport, outboundDate, returnDate)
    : null;
  return comboRow('✈️ 傳統', hasData ? data!.price : null, airlineLabel, priceColor, uri);
}

/**
 * 把「vs 昨日」百分比格式化成「  ↓8%」或「  ↑3%」附在 airline label 後。
 * 變化 < 1% 視為無感，不顯示。
 */
function formatDeltaSuffix(pct: number | null | undefined): string {
  if (pct == null || Math.abs(pct) < 1) return '';
  if (pct < 0) return `　↓${Math.abs(pct)}%`;  // 跌 = 好消息
  return `　↑${pct}%`;                          // 漲
}

/**
 * 第二行（航司行）的機場後綴。例：「台灣虎航 往返・HND」。
 * 只有多機場城市才加，避免單機場城市畫面冗餘。
 */
function airportSuffixForSecondLine(subscribedDest: string, rowAirport: string): string {
  return getCityAirports(subscribedDest).length > 1 ? `・${rowAirport}` : '';
}

/**
 * 一列：左 emoji + label、右上價格、右下航司 + ▸ 提示。
 * 傳入 uri 時整個 box 變成可點的 Flex action（直接開 Skyscanner）。
 */
function comboRow(
  label: string,
  price: number | null,
  airlineLabel: string,
  priceColor: string,
  uri: string | null
): Record<string, unknown> {
  const hasPrice = price != null;
  const box: Record<string, unknown> = {
    type: 'box',
    layout: 'vertical',
    margin: 'md',
    spacing: 'xs',
    paddingAll: '4px',
    contents: [
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          {
            type: 'text',
            text: label,
            size: 'sm',
            color: '#666666',
            flex: 3
          },
          {
            type: 'text',
            text: hasPrice ? `NT$ ${price!.toLocaleString()}` : '—',
            size: 'md',
            weight: 'bold',
            color: hasPrice ? priceColor : '#cbd5e1',
            flex: 5,
            align: 'end'
          }
        ]
      },
      {
        type: 'text',
        text: uri ? `${airlineLabel}  ▸` : airlineLabel,
        size: 'xs',
        color: '#94a3b8',
        align: 'end'
      }
    ]
  };
  if (uri) {
    box.action = { type: 'uri', label: airlineLabel.slice(0, 40), uri };
  }
  return box;
}

/**
 * 把當下時間格式化成台北時區的 "HH:mm"。
 * 用 Intl 強制 timezone，避免在 Vercel UTC runtime 上算錯。
 */
function formatTaipeiHm(): string {
  return formatTaipeiHmFromDate(new Date());
}

function formatTaipeiHmFromIso(iso: string): string {
  return formatTaipeiHmFromDate(new Date(iso));
}

function formatTaipeiHmFromDate(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
}

/**
 * Skyscanner 官方 referrals deep-link 格式。
 * 文件：https://developers.skyscanner.net/docs/referrals/flights-parameters
 * 用 day-view 進入 Skyscanner，filter 參數會正確套用（之前用消費者 URL `/transport/flights/...` 不吃 filter）。
 */
function skyscannerUrl(origin: string, destination: string, outboundDate: string, returnDate: string | null): string {
  // 來回 → 帶 inboundDate；單程 → 省略 inboundDate（Skyscanner 自動視為單程）
  const params = new URLSearchParams({
    origin,
    destination,
    outboundDate,
    adultsv2: '1',
    locale: 'zh-TW',
    market: 'TW',
    currency: 'TWD'
  });
  if (returnDate) params.set('inboundDate', returnDate);
  return `https://skyscanner.net/g/referrals/v1/flights/day-view/?${params.toString()}`;
}

/**
 * 分類版 Skyscanner deep-link：在 referrals base 後加上「只看直飛 + 經濟艙 + 該分類航司」的 query 參數。
 * - preferDirects=true → 只直飛（Skyscanner 官方參數名）
 * - cabinclass=economy → 經濟艙
 * - airlines=逗號分隔代碼 → 限制航司（單一參數，不分去/回）
 */
function skyscannerUrlForCategory(
  category: AirlineCategory,
  origin: string,
  destination: string,
  outboundDate: string,
  returnDate: string | null  // null = 單程
): string {
  const codes = getAirlineCodesByCategory(category).join(',');
  const params = new URLSearchParams({
    origin,
    destination,
    outboundDate,
    adultsv2: '1',
    locale: 'zh-TW',
    market: 'TW',
    currency: 'TWD',
    preferDirects: 'true',
    cabinclass: 'economy'
  });
  if (returnDate) params.set('inboundDate', returnDate);
  if (codes) params.set('airlines', codes);
  return `https://skyscanner.net/g/referrals/v1/flights/day-view/?${params.toString()}`;
}
