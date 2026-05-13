import { formatAirport } from '@/config/airports';

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

interface DailyFlexProps {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  cheapestPrice: number | null;
  cheapestAirline: string | null;
  outboundCount: number;
  returnCount: number;
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
  return {
    type: 'flex',
    altText: `🔔 降價提醒：${formatAirport(props.origin)} → ${formatAirport(props.destination)} NT$ ${props.cheapestPrice.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🔔 降價提醒',
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
            text: `比門檻 NT$ ${props.threshold.toLocaleString()} 低 ${dropPct}%`,
            size: 'xs',
            color: '#4ade80'
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
          return {
            type: 'text',
            text: `🎯 你的門檻 NT$ ${props.threshold!.toLocaleString()}（目前${sign} ${Math.abs(diffPct)}%）`,
            size: 'xs',
            color,
            margin: 'sm',
            wrap: true
          } as Record<string, unknown>;
        })()
      : null;

  const body: Record<string, unknown>[] = [
    {
      type: 'text',
      text: `${formatAirport(props.origin)} → ${formatAirport(props.destination)}`,
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
          text: props.cheapestPrice != null
            ? props.cheapestPrice.toLocaleString()
            : '—',
          weight: 'bold',
          size: '3xl',
          color: priceColor,
          margin: 'sm'
        }
      ]
    }
  ];
  if (compareLine) body.push(compareLine);
  body.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    contents: [
      {
        type: 'text',
        text: `🏢 ${props.cheapestAirline ?? '—'}`,
        size: 'xs',
        color: '#666666',
        flex: 1
      },
      {
        type: 'text',
        text: `去程 ${props.outboundCount} ・ 回程 ${props.returnCount}`,
        size: 'xs',
        color: '#666666',
        flex: 1,
        align: 'end'
      }
    ]
  });

  // Footer：訂閱者多一顆「我的訂閱」按鈕
  const footerButtons: Record<string, unknown>[] = [];
  if (props.sourceId && props.cheapestPrice != null) {
    // 訂閱者：主按鈕直接帶 Skyscanner deep link（已含日期 + 機場碼）
    footerButtons.push({
      type: 'button',
      style: 'primary',
      color: priceColor,
      height: 'sm',
      action: {
        type: 'uri',
        label: '🛒 用 Skyscanner 訂',
        uri: skyscannerUrl(props.origin, props.destination, props.outboundDate, props.returnDate)
      }
    });
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

function skyscannerUrl(origin: string, destination: string, outboundDate: string, returnDate: string): string {
  const ymd = (d: string) => d.replace(/-/g, '').slice(2); // 2026-06-08 -> 260608
  return `https://www.skyscanner.com.tw/transport/flights/${origin}/${destination}/${ymd(outboundDate)}/${ymd(returnDate)}/?adultsv2=1`;
}
