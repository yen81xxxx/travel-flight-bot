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
export function buildTopAirlinesBox(topAirlines: { airline: string; price: number }[] | undefined): object | null {
  if (!topAirlines || topAirlines.length === 0) return null;
  return {
    type: 'box',
    layout: 'vertical',
    margin: 'md',
    spacing: 'sm',
    contents: [
      ...topAirlines.slice(0, 3).map(a => {
        const cat = getAirlineCategory(a.airline);
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
            { type: 'text', text: a.airline, size: 'xs', color: FLEX_DARK.soft, flex: 1, wrap: false },
            { type: 'text', text: `NT$${a.price.toLocaleString()}`, size: 'xs', weight: 'bold', color: FLEX_DARK.text, align: 'end', flex: 0 }
          ]
        };
      })
    ]
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
  topAirlines?: { airline: string; price: number }[];
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
  // 開口式來回（0015）：兩段各自摘要。null / undefined = 非開口式（對稱來回 / 單程）。
  // cheapestPrice = out.price + back.price（任一段沒料 → null）。卡片改成顯示兩段。
  openJaw?: OpenJawLegs | null;
}

/** 開口式單段摘要（去段 or 回段）*/
export interface OpenJawLeg {
  origin: string;
  destination: string;        // 訂閱原始 dest（city，可能多機場 → airport 帶勝出機場）
  date: string;
  price: number | null;
  airline: string | null;
  airport: string | null;
  topAirlines: { airline: string; price: number }[];
}

export interface OpenJawLegs {
  out: OpenJawLeg;
  back: OpenJawLeg;
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

/** digest 一張 route bubble 值得看的變動門檻（%）— 跟 priceIntel reason 同級距 */
export const NOTEWORTHY_DELTA_PCT = 3;

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

/** 過濾「值得看」：達標 or |delta| ≥ 門檻。達標排前面、再按 |delta| 大到小。 */
export function pickNoteworthy(items: MultiSubsItem[]): MultiSubsItem[] {
  return items
    .filter(it => isItemHit(it) || Math.abs(bestDelta(it) ?? 0) >= NOTEWORTHY_DELTA_PCT)
    .sort((a, b) => {
      const hitDiff = Number(isItemHit(b)) - Number(isItemHit(a));
      if (hitDiff !== 0) return hitDiff;
      return Math.abs(bestDelta(b) ?? 0) - Math.abs(bestDelta(a) ?? 0);
    });
}

export function buildMultiSubsDailyFlex(props: MultiSubsDailyFlexProps) {
  const hits = props.items.filter(isItemHit);
  const noteworthy = pickNoteworthy(props.items);
  // LINE carousel 上限 12 — lead 1 張 + noteworthy cap 9（留餘裕）
  const routeBubbles = noteworthy.slice(0, 9).map(item => buildRouteBubble(item, props.sourceId));
  const quotaExhausted = props.items.some(it => it.errorReason === 'quota-exhausted');

  const lowest = hits
    .map(it => it.cheapestPrice)
    .filter((p): p is number => p != null)
    .reduce<number | null>((min, p) => (min == null || p < min ? p : min), null);

  const lead = buildDigestLeadBubble({
    total: props.items.length,
    hitCount: hits.length,
    noteworthyCount: noteworthy.length,
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
  noteworthyCount: number;
  lowest: number | null;
  quotaExhausted: boolean;
  sourceId: string;
  cachedAt: string | null;
}): Record<string, unknown> {
  // 總結句 — 按狀態分三種，誠實描述（沒變化就說沒變化）
  let summary: string;
  if (p.hitCount > 0 && p.lowest != null) {
    summary = `你追蹤的 ${p.total} 條航線今天有 ${p.hitCount} 條跌破目標價，最低 NT$${p.lowest.toLocaleString()}。`;
  } else if (p.noteworthyCount > 0) {
    summary = `今天沒有航線跌破目標價，但有 ${p.noteworthyCount} 條明顯變動，往右滑看詳細。`;
  } else {
    summary = `你追蹤的 ${p.total} 條航線今天都沒有大變化，持續監控中。`;
  }

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

/** 開口式單段的目的地 label（多機場時帶勝出機場）*/
function legDestLabel(leg: OpenJawLeg): string {
  return (leg.airport && leg.airport !== leg.destination)
    ? `${getCity(leg.destination)} (${leg.airport})`
    : formatAirport(leg.destination);
}

/**
 * 開口式 route bubble 的 body：去 / 回兩段各一列（路線 + 各段價 + 日期·航司），
 * 底下合計 + 目標對照。沒料 / 配額用光走對應降級文字。
 */
function pushOpenJawBody(bodyContents: Record<string, unknown>[], item: MultiSubsItem, hit: boolean): void {
  const oj = item.openJaw!;
  const legBox = (prefix: string, leg: OpenJawLeg): Record<string, unknown> => ({
    type: 'box', layout: 'vertical', margin: 'md', spacing: 'xs',
    contents: [
      {
        type: 'box', layout: 'baseline',
        contents: [
          { type: 'text', text: prefix, size: 'sm', weight: 'bold', color: FLEX_DARK.cyan, flex: 0 },
          { type: 'text', text: `${formatAirport(leg.origin)} → ${legDestLabel(leg)}`, size: 'sm', weight: 'bold', color: FLEX_DARK.text, wrap: true, flex: 1, margin: 'md' },
          { type: 'text', text: leg.price != null ? `NT$${leg.price.toLocaleString()}` : '查無', size: 'sm', weight: 'bold', color: leg.price != null ? FLEX_DARK.text : FLEX_DARK.faint, align: 'end', flex: 0 }
        ]
      },
      { type: 'text', text: `${leg.date}${leg.airline ? '・' + leg.airline : ''}`, size: 'xxs', color: FLEX_DARK.faint }
    ]
  });
  bodyContents.push(legBox('去', oj.out), legBox('回', oj.back));
  if (item.label) bodyContents.push({ type: 'text', text: item.label, size: 'xxs', color: FLEX_DARK.faint, margin: 'sm' });

  if (item.cheapestPrice != null) {
    const diff = Math.abs(item.cheapestPrice - item.maxPrice);
    bodyContents.push({
      type: 'box', layout: 'baseline', margin: 'lg',
      contents: [
        { type: 'text', text: '合計 NT$', size: 'sm', color: FLEX_DARK.soft, flex: 0 },
        { type: 'text', text: item.cheapestPrice.toLocaleString(), size: 'xxl', weight: 'bold', color: FLEX_DARK.text, margin: 'sm', flex: 0 }
      ]
    });
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
    bodyContents.push({ type: 'text', text: '此條件查無符合航班', size: 'sm', color: FLEX_DARK.faint, margin: 'md', wrap: true });
  }
}

/** noteworthy route bubble — 已達標/監控中 + 路線 + 勝出分類價 + delta（spec §A1） */
function buildRouteBubble(item: MultiSubsItem, sourceId: string): Record<string, unknown> {
  const hit = isItemHit(item);
  const delta = bestDelta(item);

  // tag：開口式優先標「開口式」；否則勝出分類（廉/傳）；沒料不放
  const tag = item.openJaw
    ? { text: '開口式', color: FLEX_DARK.blue }
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
  bodyContents.push(
    {
      type: 'text',
      text: `${formatAirport(item.origin)} → ${destLabel}`,
      weight: 'bold',
      size: 'md',
      color: FLEX_DARK.text,
      wrap: true
    },
    { type: 'text', text: dateText, size: 'xs', color: FLEX_DARK.faint, margin: 'xs' }
  );
  if (item.label) {
    bodyContents.push({ type: 'text', text: item.label, size: 'xxs', color: FLEX_DARK.faint, margin: 'xs' });
  }

  if (item.cheapestPrice != null) {
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'md',
      contents: [
        {
          type: 'box',
          layout: 'baseline',
          flex: 1,
          contents: [
            { type: 'text', text: 'NT$', size: 'sm', color: FLEX_DARK.soft, flex: 0 },
            {
              type: 'text',
              text: item.cheapestPrice.toLocaleString(),
              size: 'xxl',
              weight: 'bold',
              color: FLEX_DARK.text,
              margin: 'sm',
              flex: 0
            }
          ]
        },
        // R4-A: 標明基準「較昨日」（達標卡是較上週 — 兩個不同指標必須各自標清楚）
        ...(delta != null && Math.abs(delta) >= 1
          ? [{
              type: 'box',
              layout: 'vertical',
              flex: 0,
              justifyContent: 'flex-end',
              contents: [
                {
                  type: 'text',
                  text: `${delta < 0 ? '▼' : '▲'} ${Math.abs(delta)}%`,
                  size: 'sm',
                  weight: 'bold',
                  color: delta < 0 ? FLEX_DARK.green : FLEX_DARK.red,
                  align: 'end'
                },
                { type: 'text', text: '較昨日', size: 'xxs', color: FLEX_DARK.faint, align: 'end' }
              ]
            }]
          : [])
      ]
    });

    // 目標價對照 — 達標綠 / 未達灰（與 LIFF 語言一致）
    const target = item.cheapestCategory === 'full-service'
      ? (item.maxPriceTraditional ?? item.maxPrice)
      : item.maxPrice;
    const diff = Math.abs(item.cheapestPrice - target);
    bodyContents.push({
      type: 'text',
      text: hit
        ? `低於目標 NT$${target.toLocaleString()}（省 NT$${diff.toLocaleString()}）`
        : `目標 NT$${target.toLocaleString()}・還差 NT$${diff.toLocaleString()}`,
      size: 'xs',
      color: hit ? FLEX_DARK.green : FLEX_DARK.soft,
      margin: 'sm',
      wrap: true
    });

    // 比照降價警報卡：列前 3 便宜航空（廉/傳 tag + 各自價）。沒料就不畫。
    const topBox = buildTopAirlinesBox(item.topAirlines);
    if (topBox) bodyContents.push(topBox as Record<string, unknown>);
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
