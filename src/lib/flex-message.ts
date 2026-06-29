import { formatAirport, getCity, getCityAirports } from '@/config/airports';
import { getAirlineCodesByCategory, getAirlineCategory, type AirlineCategory } from '@/config/airlines';
// R4-A: 歷史卡 percentile 行用同一顆引擎（building → 不顯示 — 誠實 gate）
import { computePriceIntel } from '@/app/liff/_lib/priceIntel';
import type { PricePoint } from '@/app/liff/_types';

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

/**
 * 「前 3 便宜航空」清單列（取代只顯示一家的 carrier 列）。純函數，方便單測。
 * 每列：[廉/傳 tag] 航司名 ……… NT$價格。空陣列回 null（caller fallback 回 carrier）。
 */
/**
 * 每家航空一列：[廉/傳 tag] 航司名 出發→抵達（小字）……… 該家價格。
 * 不把多家縮成一筆（每家自己的時間 + 自己的價）。價格達標（≤ 各分類目標）轉綠。
 * targets 省略 → 不上色（全白）。沒抵達時間 → 只顯示出發；都沒有 → 不顯示時間段。
 */
export function buildTopAirlinesBox(
  topAirlines: { airline: string; price: number; depTime?: string | null; arrTime?: string | null }[] | undefined,
  targets?: { lcc: number; trad: number }
): object | null {
  if (!topAirlines || topAirlines.length === 0) return null;
  return {
    type: 'box',
    layout: 'vertical',
    margin: 'md',
    spacing: 'md',
    contents: topAirlines.slice(0, 3).map(a => {
      const cat = getAirlineCategory(a.airline);
      const timeText = a.depTime ? (a.arrTime ? `${a.depTime}→${a.arrTime}` : a.depTime) : '';
      const target = targets ? (cat === 'lcc' ? targets.lcc : targets.trad) : null;
      const hit = target != null && a.price <= target;
      return {
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
          ...(cat
            ? [{
                type: 'text',
                text: cat === 'lcc' ? '廉航' : '傳統',
                size: 'xxs',
                weight: 'bold',
                color: cat === 'lcc' ? FLEX_DARK.cyan : FLEX_DARK.yellow,
                flex: 0
              }]
            : []),
          { type: 'text', text: a.airline, size: 'xs', color: FLEX_DARK.text, flex: 0 },
          // 出發→抵達 用更小字，塞得下（user：塞不下就把字變小）
          ...(timeText
            ? [{ type: 'text', text: timeText, size: 'xxs', color: FLEX_DARK.soft, flex: 1, margin: 'sm', gravity: 'center' }]
            : [{ type: 'text', text: ' ', size: 'xxs', flex: 1 }]),
          { type: 'text', text: `NT$${a.price.toLocaleString()}`, size: 'sm', weight: 'bold', color: hit ? FLEX_DARK.green : FLEX_DARK.text, align: 'end', flex: 0 }
        ]
      };
    })
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
  // 前 3 便宜航空（跨機場 merge 後，去重取最低、由低到高）— 比照降價警報卡列出來，
  // 取代「只顯示一個最低價」。沒料 / undefined → buildRouteBubble 不畫這塊。
  topAirlines?: { airline: string; price: number; depTime?: string | null; arrTime?: string | null }[];
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
  // 開口式來回（0015 → multi-city）：去 / 回兩段路線 + 整張多城市票最低總價。
  // null / undefined = 非開口式。cheapestPrice = 整程總價（一張多城市票）。
  openJaw?: OpenJawLegs | null;
}

/** 開口式單段路線（multi-city 一張票，沒有各段單獨價）*/
export interface OpenJawLeg {
  origin: string;
  destination: string;
  date: string;
  /** 釘選班次的起飛時間 'HH:MM'（從 pinned_flight_labels 解析）；沒釘 → null */
  time?: string | null;
}

export interface OpenJawLegs {
  out: OpenJawLeg;
  back: OpenJawLeg;
  /** 一張多城市票的代表航司（最低那張的第一段航司）；null = 查無 */
  airline: string | null;
}

interface MultiSubsDailyFlexProps {
  items: MultiSubsItem[];
  sourceId: string;
  cachedAt?: string | null;
}

/* ============================================================
   L2 — 每日摘要 carousel（LINE_SURFACE_SPEC §A1）
   舊版：總覽 + 全部訂閱傾倒（11 張）。
   新版：lead bubble（總結 + 打開 Travl）+ 只放「值得看」的路線
   （達標 or 明顯變動），cap 9 — 不再 dump 全部。
   ============================================================ */

/** 該 item 是否「達標」— 任一分類跌破各自目標（lcc←maxPrice / trad←maxPriceTraditional??maxPrice） */
export function isItemHit(item: MultiSubsItem): boolean {
  // 開口式：合併價（兩段相加）跟單一目標比；沒有 lcc/traditional 分類
  if (item.openJaw) return item.cheapestPrice != null && item.cheapestPrice <= item.maxPrice;
  if (item.lcc && item.lcc.price <= item.maxPrice) return true;
  const tradTarget = item.maxPriceTraditional ?? item.maxPrice;
  if (item.traditional && item.traditional.price <= tradTarget) return true;
  return false;
}

/** 取該 item 最大幅度的 vsPrev delta（跨類 + 各分類取絕對值最大者）；全 null → null */
export function bestDelta(item: MultiSubsItem): number | null {
  const candidates = [item.vsPrevPct, item.lcc?.vsPrevPct, item.traditional?.vsPrevPct]
    .filter((x): x is number => x != null);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
}

/**
 * 排序 digest 路線卡：達標排前面、再按 |delta| 大到小。
 * **不過濾** — 每一筆訂閱都要出一張卡（user 鐵則：訂閱幾筆就全顯示）。
 * 排序只是為了「萬一超過 LINE carousel 上限被截，重要的先留」。
 */
export function orderRoutesForDigest(items: MultiSubsItem[]): MultiSubsItem[] {
  return [...items].sort((a, b) => {
    const hitDiff = Number(isItemHit(b)) - Number(isItemHit(a));
    if (hitDiff !== 0) return hitDiff;
    return Math.abs(bestDelta(b) ?? 0) - Math.abs(bestDelta(a) ?? 0);
  });
}

export function buildMultiSubsDailyFlex(props: MultiSubsDailyFlexProps) {
  const hits = props.items.filter(isItemHit);
  // 不過濾：每一筆訂閱都出一張卡（user 鐵則：訂閱幾筆就全顯示，不藏沒達標/沒變動的）。
  // 仍排序（達標排前），只為了萬一超過 LINE 上限被截時重要的先留。
  const ordered = orderRoutesForDigest(props.items);
  const MAX_ROUTE_BUBBLES = 11; // LINE carousel 硬上限 12 = lead 1 + routes 11
  const shown = ordered.slice(0, MAX_ROUTE_BUBBLES);
  const routeBubbles = shown.map(item => buildRouteBubble(item, props.sourceId));
  const truncated = ordered.length - shown.length;
  const quotaExhausted = props.items.some(it => it.errorReason === 'quota-exhausted');

  const lowest = hits
    .map(it => it.cheapestPrice)
    .filter((p): p is number => p != null)
    .reduce<number | null>((min, p) => (min == null || p < min ? p : min), null);

  const lead = buildDigestLeadBubble({
    total: props.items.length,
    hitCount: hits.length,
    truncated,
    lowest,
    quotaExhausted,
    sourceId: props.sourceId,
    cachedAt: props.cachedAt ?? null
  });

  const altText = hits.length > 0
    ? `今日機票摘要：${hits.length} 條已達標，最低 NT$${(lowest ?? 0).toLocaleString()}`
    : '今日機票摘要：今天沒有航線跌破目標價';

  return {
    type: 'flex',
    altText,
    contents: {
      type: 'carousel',
      contents: [lead, ...routeBubbles]
    }
  };
}

/** Lead bubble — 總結 + 打開 Travl（spec §A1） */
function buildDigestLeadBubble(p: {
  total: number;
  hitCount: number;
  truncated: number;
  lowest: number | null;
  quotaExhausted: boolean;
  sourceId: string;
  cachedAt: string | null;
}): Record<string, unknown> {
  // 總結句 — 達標就報達標數；都沒達標就請往右滑看每條現價（每條都有出卡，不藏）
  const summary = p.hitCount > 0 && p.lowest != null
    ? `你追蹤的 ${p.total} 條航線今天有 ${p.hitCount} 條跌破目標價，最低 NT$${p.lowest.toLocaleString()}。`
    : `你追蹤的 ${p.total} 條航線今天都沒跌破目標價，往右滑看每條現價。`;

  const bodyContents: Record<string, unknown>[] = [
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: String(p.hitCount),
          size: '3xl',
          weight: 'bold',
          color: p.hitCount > 0 ? FLEX_DARK.green : FLEX_DARK.faint,
          flex: 0
        },
        { type: 'text', text: '條已達標', size: 'sm', color: FLEX_DARK.soft, flex: 0 }
      ]
    },
    { type: 'text', text: summary, size: 'sm', color: FLEX_DARK.text, wrap: true, margin: 'md' }
  ];

  if (p.truncated > 0) {
    // 超過 LINE carousel 上限被截 — fail loud，明講少了幾條（別讓 user 以為全到齊）
    bodyContents.push({
      type: 'text',
      text: `路線較多，只顯示前 ${p.total - p.truncated} 條（共 ${p.total} 條）。`,
      size: 'xxs',
      color: '#ff9f0a',
      wrap: true,
      margin: 'md'
    });
  }

  if (p.quotaExhausted) {
    // 部分路線配額暫滿 — 不藏（fail loud），但也不佔 route bubble 位置
    bodyContents.push({
      type: 'text',
      text: '部分路線今日查詢額度暫滿，明日自動恢復。',
      size: 'xxs',
      color: '#ff9f0a',
      wrap: true,
      margin: 'md'
    });
  }

  const cacheHint = p.cachedAt ? `（抓 ${formatTaipeiHmFromIso(p.cachedAt)} 的快取）` : '';
  bodyContents.push({
    type: 'text',
    text: `${formatTaipeiHm()} 更新${cacheHint}`,
    size: 'xxs',
    color: FLEX_DARK.faint,
    margin: 'md',
    wrap: true
  });

  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: FLEX_DARK.cardBg,
      paddingAll: '16px',
      paddingBottom: '0px',
      contents: [
        { type: 'text', text: '今日機票摘要', weight: 'bold', size: 'md', color: FLEX_DARK.text }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: FLEX_DARK.cardBg,
      paddingAll: '16px',
      paddingTop: '12px',
      contents: bodyContents
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: FLEX_DARK.cardBg,
      paddingAll: '16px',
      paddingTop: '0px',
      contents: [{
        type: 'button',
        style: 'primary',
        color: FLEX_DARK.blue,
        height: 'sm',
        action: {
          type: 'uri',
          label: '打開 Travl 看全部',
          uri: subscriptionsUrlFor(p.sourceId)
        }
      }]
    }
  };
}

/**
 * 開口式 route bubble 的 body（multi-city 一張票）：去 / 回兩段路線各一列，
 * 底下「一張多城市票 NT$總價（航司 起）」+ 目標對照。沒料 / 配額用光走降級文字。
 */
function pushOpenJawBody(bodyContents: Record<string, unknown>[], item: MultiSubsItem, hit: boolean): void {
  const oj = item.openJaw!;
  const legRow = (prefix: string, leg: OpenJawLeg): Record<string, unknown> => {
    // 日期（非補零 M/D，跟 LIFF 卡一致）＋釘選班次起飛時間（有釘才接，例：1/29 15:20）
    const parts = leg.date.split('-');
    const md = parts.length === 3 ? `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}` : leg.date;
    const dateText = md + (leg.time ? ` ${leg.time}` : '');
    return {
      type: 'box', layout: 'baseline', margin: 'md',
      contents: [
        { type: 'text', text: prefix, size: 'sm', weight: 'bold', color: FLEX_DARK.cyan, flex: 0 },
        { type: 'text', text: `${formatAirport(leg.origin)} → ${formatAirport(leg.destination)}`, size: 'sm', weight: 'bold', color: FLEX_DARK.text, wrap: true, flex: 1, margin: 'md' },
        { type: 'text', text: dateText, size: 'xs', color: leg.time ? FLEX_DARK.soft : FLEX_DARK.faint, flex: 0 }
      ]
    };
  };
  bodyContents.push(legRow('去', oj.out), legRow('回', oj.back));
  if (item.label) bodyContents.push({ type: 'text', text: item.label, size: 'xxs', color: FLEX_DARK.faint, margin: 'sm' });

  if (item.cheapestPrice != null) {
    const diff = Math.abs(item.cheapestPrice - item.maxPrice);
    bodyContents.push({
      type: 'box', layout: 'baseline', margin: 'lg',
      contents: [
        { type: 'text', text: '一張票 NT$', size: 'sm', color: FLEX_DARK.soft, flex: 0 },
        { type: 'text', text: item.cheapestPrice.toLocaleString(), size: 'xxl', weight: 'bold', color: FLEX_DARK.text, margin: 'sm', flex: 0 }
      ]
    });
    if (oj.airline) bodyContents.push({ type: 'text', text: `多城市單一票・${oj.airline} 起`, size: 'xxs', color: FLEX_DARK.faint, margin: 'xs' });
    bodyContents.push({
      type: 'text',
      text: hit
        ? `低於目標 NT$${item.maxPrice.toLocaleString()}（省 NT$${diff.toLocaleString()}）`
        : `目標 NT$${item.maxPrice.toLocaleString()}・還差 NT$${diff.toLocaleString()}`,
      size: 'xs', color: hit ? FLEX_DARK.green : FLEX_DARK.soft, margin: 'sm', wrap: true
    });
  } else if (item.errorReason === 'quota-exhausted') {
    bodyContents.push({ type: 'text', text: '今日查詢額度暫滿，明日自動恢復', size: 'sm', color: '#ff9f0a', margin: 'md', wrap: true });
  } else {
    bodyContents.push({ type: 'text', text: '此條件查無多城市票', size: 'sm', color: FLEX_DARK.faint, margin: 'md', wrap: true });
  }
}

/** noteworthy route bubble — 已達標/監控中 + 路線 + 勝出分類價 + delta（spec §A1） */
function buildRouteBubble(item: MultiSubsItem, sourceId: string): Record<string, unknown> {
  const hit = isItemHit(item);

  // tag：異地來回（開口式：去回不同點進出）優先；否則勝出分類（廉/傳）；沒料不放
  const tag = item.openJaw
    ? { text: '異地來回', color: FLEX_DARK.blue }
    : item.cheapestCategory === 'lcc'
      ? { text: '廉航', color: FLEX_DARK.cyan }
      : item.cheapestCategory === 'full-service'
        ? { text: '傳統', color: FLEX_DARK.yellow }
        : null;

  const showAirport = item.cheapestAirport && item.cheapestAirport !== item.destination;
  const destLabel = showAirport
    ? `${getCity(item.destination)} (${item.cheapestAirport})`
    : formatAirport(item.destination);
  const dateText = item.returnDate
    ? `${item.outboundDate} ~ ${item.returnDate}`
    : `單程 ${item.outboundDate}`;

  const bodyContents: Record<string, unknown>[] = [];
  if (item.openJaw) {
    // 開口式：兩段各一列 + 合計（不走下面的單一路線版面）
    pushOpenJawBody(bodyContents, item, hit);
  } else {
  // 目標寫一次（接在日期後）；每家航空的達標各自上色，不放會誤導的單一大標題價
  const tradTarget = item.maxPriceTraditional ?? item.maxPrice;
  bodyContents.push(
    {
      type: 'text',
      text: `${formatAirport(item.origin)} → ${destLabel}`,
      weight: 'bold',
      size: 'md',
      color: FLEX_DARK.text,
      wrap: true
    },
    { type: 'text', text: `${dateText}　·　目標 NT$${item.maxPrice.toLocaleString()}`, size: 'xs', color: FLEX_DARK.faint, margin: 'xs', wrap: true }
  );
  if (item.label) {
    bodyContents.push({ type: 'text', text: item.label, size: 'xxs', color: FLEX_DARK.faint, margin: 'xs' });
  }

  // 每家航空各一列（航司・出發→抵達・該家價；達標轉綠）。多家不縮成一筆、不放單一大標題價（會誤導）。
  const topBox = buildTopAirlinesBox(item.topAirlines, { lcc: item.maxPrice, trad: tradTarget });
  if (topBox) {
    bodyContents.push(topBox as Record<string, unknown>);
  } else if (item.cheapestPrice != null) {
    // 有總價但沒逐家明細（少見）→ 至少標一個最低價，別空白
    bodyContents.push({ type: 'text', text: `最低 NT$${item.cheapestPrice.toLocaleString()}`, size: 'md', weight: 'bold', color: hit ? FLEX_DARK.green : FLEX_DARK.text, margin: 'md' });
  } else if (item.errorReason === 'quota-exhausted') {
    bodyContents.push({
      type: 'text', text: '今日查詢額度暫滿，明日自動恢復', size: 'sm', color: '#ff9f0a', margin: 'md', wrap: true
    });
  } else {
    bodyContents.push({
      type: 'text', text: '此條件查無符合航班', size: 'sm', color: FLEX_DARK.faint, margin: 'md', wrap: true
    });
  }
  }

  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'horizontal',
      alignItems: 'center',
      backgroundColor: hit ? '#102818' : '#222226',
      paddingAll: '12px',
      paddingStart: '16px',
      contents: [
        {
          type: 'text',
          text: hit ? '已達標' : '監控中',
          weight: 'bold',
          size: 'sm',
          color: hit ? FLEX_DARK.green : FLEX_DARK.soft,
          flex: 1
        },
        ...(tag
          ? [{ type: 'text', text: tag.text, size: 'xs', weight: 'bold', color: tag.color, flex: 0 }]
          : [])
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: FLEX_DARK.cardBg,
      paddingAll: '16px',
      contents: bodyContents
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: FLEX_DARK.cardBg,
      paddingAll: '16px',
      paddingTop: '0px',
      contents: [{
        type: 'button',
        style: 'primary',
        color: FLEX_DARK.blue,
        height: 'sm',
        action: {
          type: 'uri',
          label: '看走勢與航班',
          uri: subscriptionsUrlFor(sourceId)
        }
      }]
    }
  };
}

/* ============================================================
   R4-A — 歷史走勢卡（LINE_SURFACE_SPEC §A4）
   postback「看歷史走勢」的回覆。最後一個未翻新的介面 — 聊天記錄裡的
   舊按鈕仍會觸發，必須跟上深色/verdict 語言。
   ============================================================ */

export interface HistoryFlexProps {
  origin: string;
  destination: string;          // 訂閱原始 dest（顯示用，例：HND）
  outboundDate: string;
  returnDate: string;
  lccPoints: { date: string; minPrice: number }[];   // 廉航每日最低（按日期升冪）
  tradPoints: { date: string; minPrice: number }[];  // 傳統每日最低（按日期升冪）
  threshold: number;
}

/**
 * 兩分類 → 單一「該路線每日最低」series（跨類取 min）。
 * 跟 LIFF history 同語意（with-quotes 的 daily 也是不分類 min）— parity。
 */
export function mergeDailySeries(
  lccPoints: { date: string; minPrice: number }[],
  tradPoints: { date: string; minPrice: number }[]
): { date: string; minPrice: number }[] {
  const byDay = new Map<string, number>();
  for (const p of [...lccPoints, ...tradPoints]) {
    const cur = byDay.get(p.date);
    if (cur == null || p.minPrice < cur) byDay.set(p.date, p.minPrice);
  }
  return Array.from(byDay.entries())
    .map(([date, minPrice]) => ({ date, minPrice }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildHistoryFlex(props: HistoryFlexProps) {
  const series = mergeDailySeries(props.lccPoints, props.tradPoints).slice(-30);
  const prices = series.map(p => p.minPrice);
  const hasAny = prices.length > 0;

  const routeText = `${getCity(props.origin)} → ${getCity(props.destination)}`;
  const codeDateText = `${props.origin} → ${props.destination}・${props.outboundDate} ~ ${props.returnDate}`;

  const bodyContents: Record<string, unknown>[] = [
    { type: 'text', text: routeText, weight: 'bold', size: 'md', color: FLEX_DARK.text, wrap: true },
    { type: 'text', text: codeDateText, size: 'xs', color: FLEX_DARK.faint, margin: 'xs' }
  ];

  let isRecentLow = false;

  if (!hasAny) {
    bodyContents.push(
      { type: 'text', text: '尚無歷史資料', size: 'sm', color: FLEX_DARK.soft, align: 'center', margin: 'lg' },
      { type: 'text', text: '再等幾天累積後就能看走勢', size: 'xs', color: FLEX_DARK.faint, align: 'center', margin: 'xs' }
    );
  } else {
    const current = prices[prices.length - 1];
    const lo = Math.min(...prices, props.threshold);
    const hi = Math.max(...prices, props.threshold);
    const span = hi - lo || 1;
    const hiPrice = Math.max(...prices);
    const first = prices[0];
    isRecentLow = current <= Math.min(...prices);

    // === 30 天 bar chart（堆疊 box — Flex 沒 SVG）+ 目標線 tag（absolute overlay） ===
    const CHART_H = 84;
    const bars = prices.map((p, i) => ({
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'filler' }],
      height: `${Math.round(8 + ((p - lo) / span) * (CHART_H - 12))}px`,
      // 顏色說故事：今天 = 亮綠、跌破目標 = 綠、其他 = 暗青（spec A4）
      backgroundColor: i === prices.length - 1
        ? FLEX_DARK.green
        : p <= props.threshold ? '#30d158aa' : '#64d2ff55',
      cornerRadius: '2px',
      flex: 1
    }));
    // 目標線位置：價格越高越靠上（top%）
    const targetTopPct = Math.round((1 - (props.threshold - lo) / span) * 100);
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      height: `${CHART_H}px`,
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          spacing: '2px',
          alignItems: 'flex-end',
          height: `${CHART_H}px`,
          contents: bars
        },
        // 目標線（absolute overlay）— Flex 畫不了虛線，用半透明黃 hairline + tag
        {
          type: 'box',
          layout: 'vertical',
          position: 'absolute',
          offsetTop: `${Math.min(92, Math.max(0, targetTopPct))}%`,
          offsetStart: '0px',
          width: '100%',
          height: '2px',
          backgroundColor: '#ffd60a66',
          contents: [{ type: 'filler' }]
        },
        {
          type: 'box',
          layout: 'horizontal',
          position: 'absolute',
          offsetTop: `${Math.min(80, Math.max(0, targetTopPct))}%`,
          offsetEnd: '0px',
          contents: [{
            type: 'text',
            text: `目標 ${props.threshold.toLocaleString()}`,
            size: 'xxs',
            color: '#ffd60a',
            align: 'end'
          }]
        }
      ]
    });
    // 軸標
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'sm',
      contents: [
        { type: 'text', text: '30 天前', size: 'xxs', color: FLEX_DARK.faint },
        { type: 'text', text: '今天', size: 'xxs', color: FLEX_DARK.faint, align: 'end' }
      ]
    });

    // === 3-up stats：目前 / 30 天最高 / 期間變化（vs 第一天 — 跟 prototype 一致） ===
    const periodPct = first > 0 ? Math.round(((current - first) / first) * 100) : null;
    const stat = (k: string, v: string, color: string) => ({
      type: 'box',
      layout: 'vertical',
      flex: 1,
      contents: [
        { type: 'text', text: k, size: 'xxs', color: FLEX_DARK.faint },
        { type: 'text', text: v, size: 'sm', weight: 'bold', color }
      ]
    });
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'lg',
      spacing: 'sm',
      contents: [
        stat('目前', `NT$${current.toLocaleString()}`, FLEX_DARK.green),
        stat('30 天最高', `NT$${hiPrice.toLocaleString()}`, FLEX_DARK.text),
        ...(periodPct != null
          ? [stat('期間變化', `${periodPct > 0 ? '+' : ''}${periodPct}%`, periodPct <= 0 ? FLEX_DARK.cyan : FLEX_DARK.red)]
          : [])
      ]
    });

    // === percentile 行 — 同一顆 priceIntel（不夠 14 點 = building → 誠實不顯示） ===
    const history: PricePoint[] = series.map(p => ({ d: p.date.slice(5), p: p.minPrice }));
    const intel = computePriceIntel(history, current, props.threshold, null, null);
    if (intel.status === 'ready') {
      bodyContents.push({
        type: 'text',
        text: `目前落在近 30 天第 ${intel.percentile} 百分位（越低越便宜）`,
        size: 'xs',
        color: FLEX_DARK.soft,
        margin: 'md',
        wrap: true
      });
    }
  }

  return {
    type: 'flex',
    altText: `30 天價格走勢：${props.origin} → ${props.destination}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        backgroundColor: '#222226',
        paddingAll: '12px',
        paddingStart: '16px',
        contents: [
          { type: 'text', text: '30 天價格走勢', weight: 'bold', size: 'sm', color: FLEX_DARK.soft, flex: 1 },
          ...(isRecentLow
            ? [{
                type: 'box',
                layout: 'vertical',
                flex: 0,
                backgroundColor: '#30d15838',
                cornerRadius: '999px',
                paddingAll: '4px',
                paddingStart: '10px',
                paddingEnd: '10px',
                contents: [{ type: 'text', text: '近期最低', size: 'xxs', weight: 'bold', color: '#ffffff' }]
              }]
            : [])
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: FLEX_DARK.cardBg,
        paddingAll: '16px',
        contents: bodyContents
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: FLEX_DARK.cardBg,
        paddingAll: '16px',
        paddingTop: '0px',
        contents: [{
          type: 'button',
          style: 'primary',
          color: FLEX_DARK.blue,
          height: 'sm',
          action: { type: 'uri', label: '打開 Travl 看詳情', uri: subscriptionsUrlFor() }
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
