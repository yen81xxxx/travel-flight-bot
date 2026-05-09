import { formatAirport } from '@/config/airports';

interface AlertFlexProps {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  cheapestPrice: number;
  threshold: number;
  airline: string;
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
              uri: `${APP_URL}/liff/subscriptions`
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
        contents: [
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
                color: '#ff7a45',
                margin: 'sm'
              }
            ]
          },
          {
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
              type: 'message',
              label: '🔍 查其他航線',
              text: '查航班'
            }
          }
        ]
      }
    }
  };
}

/**
 * Skyscanner 的 deep link 比 Google Flights 可靠 —— 直接帶機場碼 + 日期到 URL path，
 * 不需要 NLP parse 就能 pre-fill 搜尋條件。日期格式是 YYMMDD。
 */
function flightSearchUrl(p: AlertFlexProps): string {
  const ymd = (d: string) => d.replace(/-/g, '').slice(2); // 2026-06-08 -> 260608
  return `https://www.skyscanner.com.tw/transport/flights/${p.origin}/${p.destination}/${ymd(p.outboundDate)}/${ymd(p.returnDate)}/?adultsv2=1`;
}
