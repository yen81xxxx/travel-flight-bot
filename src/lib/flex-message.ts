import { formatAirport, getCity, getCityAirports } from '@/config/airports';
import { getAirlineCodesByCategory, type AirlineCategory } from '@/config/airlines';

interface AlertFlexProps {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  cheapestPrice: number;
  threshold: number;
  airline: string;
  // 這條訂閱的 source_id（user 或 group）。給「我的訂閱」按鈕帶 ctx 用，
  // 不傳就 fallback 到普通連結（個人訂閱情境）
  sourceId?: string;
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
  returnDate: string;
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
 * 降價提醒 Flex Message
 */
export function buildAlertFlex(props: AlertFlexProps) {
  const drop = props.threshold - props.cheapestPrice;
  const dropPct = Math.round((drop / props.threshold) * 100);
  // 邊界情況：當降幅 < 1%（例如 NT$ 18,538 vs 門檻 18,546，只差 NT$ 8）顯示「降價 0%」
  // 會看起來像 bug。改成「達到目標價」+ 顯示絕對便宜金額。
  const isAtThreshold = dropPct < 1;
  const title = isAtThreshold ? '🎯 達到目標價' : '🔔 降價提醒';
  const compareLine = isAtThreshold
    ? `達到你的門檻 NT$ ${props.threshold.toLocaleString()}（便宜 NT$ ${drop.toLocaleString()}）`
    : `比門檻 NT$ ${props.threshold.toLocaleString()} 低 ${dropPct}%`;
  return {
    type: 'flex',
    altText: `${title}：${formatAirport(props.origin)} → ${formatAirport(props.destination)} NT$ ${props.cheapestPrice.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: title,
            weight: 'bold',
            size: 'lg',
            color: '#ffffff'
          }
        ],
        backgroundColor: '#ff7a45',
        paddingAll: '16px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: '✈️',
                size: 'lg',
                flex: 0
              },
              {
                type: 'text',
                text: `${formatAirport(props.origin)} → ${formatAirport(props.destination)}`,
                weight: 'bold',
                size: 'md',
                wrap: true,
                margin: 'md'
              }
            ]
          },
          {
            type: 'text',
            text: `📅 ${props.outboundDate} ~ ${props.returnDate}`,
            size: 'sm',
            color: '#666666'
          },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'baseline',
            contents: [
              {
                type: 'text',
                text: 'NT$',
                size: 'sm',
                color: '#666666',
                flex: 0
              },
              {
                type: 'text',
                text: props.cheapestPrice.toLocaleString(),
                weight: 'bold',
                size: '3xl',
                color: '#ff7a45',
                margin: 'sm'
              }
            ]
          },
          {
            type: 'text',
            text: compareLine,
            size: 'xs',
            color: '#4ade80',
            wrap: true
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: '🏢 主推',
                size: 'xs',
                color: '#888888',
                flex: 2
              },
              {
                type: 'text',
                text: props.airline,
                size: 'sm',
                weight: 'bold',
                flex: 5
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#ff7a45',
            height: 'sm',
            action: {
              type: 'uri',
              label: '🔍 用 Skyscanner 訂（已帶條件）',
              uri: flightSearchUrl(props)
            }
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '📋 我的訂閱',
              uri: subscriptionsUrlFor(props.sourceId)
            }
          }
        ]
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
      text: `📅 ${props.outboundDate} ~ ${props.returnDate}`,
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
export interface MultiSubsItem {
  origin: string;
  destination: string;           // 訂閱原始 dest（可能 HND，多機場時 cheapestAirport 會帶實際勝出機場）
  outboundDate: string;
  returnDate: string;
  maxPrice: number;              // threshold
  label?: string | null;
  cheapestPrice: number | null;
  cheapestAirport: string | null;        // 跨機場勝出的那一個
  cheapestCategory: 'lcc' | 'full-service' | null;
  cheapestAirline: string | null;
  vsPrevPct: number | null;
}

interface MultiSubsDailyFlexProps {
  items: MultiSubsItem[];
  sourceId: string;
  cachedAt?: string | null;
}

export function buildMultiSubsDailyFlex(props: MultiSubsDailyFlexProps) {
  const itemBlocks: Record<string, unknown>[] = [];
  for (let i = 0; i < props.items.length; i++) {
    if (i > 0) itemBlocks.push({ type: 'separator', margin: 'md' });
    itemBlocks.push(buildSubItemBlock(props.items[i]));
  }

  const footerButtons: Record<string, unknown>[] = [{
    type: 'button',
    style: 'secondary',
    height: 'sm',
    action: {
      type: 'uri',
      label: '📋 我的訂閱',
      uri: subscriptionsUrlFor(props.sourceId)
    }
  }];

  const cacheHint = props.cachedAt ? `（抓 ${formatTaipeiHmFromIso(props.cachedAt)} 的快取）` : '';

  return {
    type: 'flex',
    altText: `今日機票 ${props.items.length} 筆訂閱`,
    contents: {
      type: 'bubble',
      size: 'mega',  // 比 kilo 寬，多訂閱舒服
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `✈️ 今日機票 · ${props.items.length} 筆`,
            weight: 'bold',
            size: 'lg',
            color: '#ffffff'
          },
          {
            type: 'text',
            text: `🕐 ${formatTaipeiHm()} 更新${cacheHint}`,
            size: 'xs',
            color: '#cbd5e1',
            margin: 'xs',
            wrap: true
          }
        ],
        backgroundColor: '#1a2238',
        paddingAll: '16px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: itemBlocks
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

/** 多訂閱總表中的單一訂閱列（整 box 可點 → Skyscanner with 該分類篩選）*/
function buildSubItemBlock(item: MultiSubsItem): Record<string, unknown> {
  // 跨機場勝出時顯示實際機場（例如 NRT），否則沿用訂閱原 destination
  const showAirport = item.cheapestAirport && item.cheapestAirport !== item.destination;
  const destCity = getCity(item.destination);
  const destLabel = showAirport
    ? `${destCity} (${item.cheapestAirport})`
    : formatAirport(item.destination);
  const routeText = `${formatAirport(item.origin)} → ${destLabel}`;
  const dateText = `📅 ${item.outboundDate} ~ ${item.returnDate}`;

  const blocks: Record<string, unknown>[] = [
    { type: 'text', text: routeText, weight: 'bold', size: 'sm', wrap: true },
    { type: 'text', text: dateText, size: 'xs', color: '#94a3b8' }
  ];
  if (item.label) {
    blocks.push({ type: 'text', text: `📝 ${item.label}`, size: 'xs', color: '#94a3b8' });
  }

  if (item.cheapestPrice == null) {
    blocks.push({ type: 'text', text: '❌ 查無資料', size: 'sm', color: '#cbd5e1', margin: 'sm' });
  } else {
    const priceColor = item.cheapestPrice <= item.maxPrice ? '#22c55e' : '#ff7a45';
    const catIcon = item.cheapestCategory === 'lcc' ? '🛩' : item.cheapestCategory === 'full-service' ? '🏢' : '';
    const airlineName = item.cheapestAirline ?? '';
    const deltaSuffix = formatDeltaSuffix(item.vsPrevPct);

    blocks.push({
      type: 'box',
      layout: 'baseline',
      margin: 'sm',
      contents: [
        { type: 'text', text: 'NT$', size: 'xs', color: '#666666', flex: 0 },
        { type: 'text', text: item.cheapestPrice.toLocaleString(), size: 'xl', weight: 'bold', color: priceColor, margin: 'xs' },
        { type: 'text', text: `${catIcon} ${airlineName}${deltaSuffix}`, size: 'xs', color: '#94a3b8', flex: 0, margin: 'sm' }
      ]
    });

    // 門檻比較行
    const diff = item.cheapestPrice - item.maxPrice;
    const diffPct = Math.round((Math.abs(diff) / item.maxPrice) * 100);
    const isBelow = diff <= 0;
    const thText = isBelow
      ? `🎯 達門檻 ✓（比門檻低 ${diffPct}%）`
      : `🎯 距離門檻還差 NT$ ${Math.abs(diff).toLocaleString()}（高 ${diffPct}%）`;
    const thColor = isBelow ? '#22c55e' : '#94a3b8';
    blocks.push({
      type: 'text',
      text: thText,
      size: 'xs',
      color: thColor,
      wrap: true
    });

    blocks.push({
      type: 'text',
      text: '▸ 點此用 Skyscanner 訂',
      size: 'xs',
      color: '#60a5fa',
      align: 'end',
      margin: 'xs'
    });
  }

  const block: Record<string, unknown> = {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    paddingAll: '6px',
    contents: blocks
  };

  // 整 box 可點 → Skyscanner with 勝出分類的篩選
  if (item.cheapestPrice != null && item.cheapestCategory && item.cheapestAirport) {
    block.action = {
      type: 'uri',
      label: airlineLabelForAction(item),
      uri: skyscannerUrlForCategory(item.cheapestCategory, item.origin, item.cheapestAirport, item.outboundDate, item.returnDate)
    };
  }
  return block;
}

function airlineLabelForAction(item: MultiSubsItem): string {
  const base = `${item.origin}→${item.cheapestAirport ?? item.destination}`;
  return base.slice(0, 40);
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
  returnDate: string,
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
  return comboRow('🛩 廉航', hasData ? data!.price : null, airlineLabel, priceColor, uri);
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
  returnDate: string,
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
  return comboRow('🏢 傳統', hasData ? data!.price : null, airlineLabel, priceColor, uri);
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
function skyscannerUrl(origin: string, destination: string, outboundDate: string, returnDate: string): string {
  const params = new URLSearchParams({
    origin,
    destination,
    outboundDate,
    inboundDate: returnDate,
    adultsv2: '1',
    locale: 'zh-TW',
    market: 'TW',
    currency: 'TWD'
  });
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
  returnDate: string
): string {
  const codes = getAirlineCodesByCategory(category).join(',');
  const params = new URLSearchParams({
    origin,
    destination,
    outboundDate,
    inboundDate: returnDate,
    adultsv2: '1',
    locale: 'zh-TW',
    market: 'TW',
    currency: 'TWD',
    preferDirects: 'true',
    cabinclass: 'economy'
  });
  if (codes) params.set('airlines', codes);
  return `https://skyscanner.net/g/referrals/v1/flights/day-view/?${params.toString()}`;
}
