/**
 * Group-watch Flex Message — 跌破 derived_target 時推到 LINE 群組的卡片
 *
 * 跟個人 `buildAlertFlex` (flex-message.ts) 不同的地方：
 *   - 紫色 accent (跟 LIFF group block 同色語意)
 *   - hero 寫「群組目標 NT$X 已達標」+「N 人在追」
 *   - 顯示前 3 個 voter（如果有投票中的日期選項）
 *   - 兩個 button：
 *       「打開投票 / 詳情」→ LIFF 詳細頁 (G3 poll 可見)
 *       「+ 我也要追」    → LIFF 詳細頁同 endpoint，視覺上強調 viral 入口
 *
 * 設計手冊 PRODUCT_STRATEGY §2 Gap 2：每次群組 alert 都是病毒擴散面 —
 * 群組 5 人全部看得到，可能多 5 個新追蹤者。
 *
 * 純函數 0 副作用 — 把它跟「實際 push」分開測（測 JSON 結構即可）。
 */
import { formatAirport } from '@/config/airports';
import { FLEX_DARK, VERDICT_FLEX_META } from './flex-message';
import type { Verdict } from '@/app/liff/_lib/priceIntel';

export interface GroupAlertFlexProps {
  origin: string;
  destination: string;
  /** 'YYYY-MM-DD' 去程 — '' 或 null 代表「不限日期」訂閱（罕見）*/
  outboundDate: string;
  /** 'YYYY-MM-DD' 回程，null 代表單程 */
  returnDate: string | null;
  /** 當前最低價 */
  cheapestPrice: number;
  /** 共識門檻（subscriptions.max_price，G2 之後 = derived_target） */
  threshold: number;
  /** 最便宜航司 — '-' 表沒抓到 */
  airline: string;
  /** group_id（LINE C... start） — LIFF URL 用，帶 ?ctx=group_id 進去 */
  groupId: string;
  /** subscription_id — LIFF 直接導去該 watch 詳細 */
  subscriptionId: number;
  /** 群組裡正在追這條的人數 (group_member rows) */
  memberCount: number;
  /** 前 3 個成員顯示名（>3 時截斷成「Alice, Bob, +2」） */
  topMemberNames: string[];
  /** 票數最高的投票選項（如有）— 顯示「目前 X 票領先：8/14–8/18」*/
  topVote?: {
    out_date: string;
    ret_date: string | null;
    voteCount: number;
  } | null;
  /** L1: priceIntel verdict（與 LIFF / 個人推播同引擎）；null = 不顯示 badge */
  verdict?: Verdict | null;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://travel-flight-bot.vercel.app';
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID ?? '';

/** group 內看的詳細頁 deep link — 帶 ?ctx= 讓 watchlist 知道是哪個群組情境 */
function buildLiffUrl(groupId: string): string {
  const ctxQS = `?ctx=${encodeURIComponent(groupId)}`;
  return LIFF_ID
    ? `https://liff.line.me/${LIFF_ID}${ctxQS}`
    : `${APP_URL}/liff${ctxQS}`;
}

/**
 * 顯示前 N 個成員，>N 截斷成「A, B, C, +K」
 * 抽純函數方便單測 + 邊界（0 成員、剛好 3、4 以上）
 */
export function formatMemberPreview(names: string[], n = 3): string {
  if (names.length === 0) return '';
  if (names.length <= n) return names.join(', ');
  const shown = names.slice(0, n).join(', ');
  return `${shown}, +${names.length - n}`;
}

export function buildGroupAlertFlex(props: GroupAlertFlexProps) {
  const drop = props.threshold - props.cheapestPrice;
  const dropPct = Math.round((drop / props.threshold) * 100);
  const isAtThreshold = dropPct < 1;
  const title = isAtThreshold ? '群組已達標' : '群組降價提醒';
  const dateRange = props.returnDate
    ? `${props.outboundDate} ~ ${props.returnDate}`
    : (props.outboundDate ? `單程 ${props.outboundDate}` : '不限定日期');
  const compareLine = isAtThreshold
    ? `達到群組目標 NT$ ${props.threshold.toLocaleString()}（便宜 NT$ ${drop.toLocaleString()}）`
    : `比群組目標 NT$ ${props.threshold.toLocaleString()} 低 ${dropPct}%`;
  const memberPreview = formatMemberPreview(props.topMemberNames);
  const liffUrl = buildLiffUrl(props.groupId);

  // L1: body 轉深色（LINE_SURFACE_SPEC §A — 三種推播卡同語言：深底 #1b1b1f）
  // 紫 accent 保留（群組語意），灰階換成 dark 版 soft/faint
  const bodyRows: object[] = [
    {
      type: 'text',
      text: `${formatAirport(props.origin)} → ${formatAirport(props.destination)}`,
      weight: 'bold',
      size: 'md',
      color: FLEX_DARK.text,
      wrap: true
    },
    {
      type: 'text',
      text: dateRange,
      size: 'sm',
      color: FLEX_DARK.faint
    },
    { type: 'separator', margin: 'md', color: '#3a3a3e' },
    {
      type: 'box',
      layout: 'horizontal',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: '目前最低',
          size: 'sm',
          color: FLEX_DARK.soft,
          flex: 0
        },
        {
          type: 'text',
          text: `NT$ ${props.cheapestPrice.toLocaleString()}`,
          weight: 'bold',
          size: 'lg',
          align: 'end',
          color: FLEX_DARK.text
        }
      ]
    },
    {
      type: 'text',
      text: compareLine,
      size: 'xs',
      color: '#bf5af2',
      wrap: true
    },
    {
      type: 'text',
      text: `航司：${props.airline}`,
      size: 'xs',
      color: FLEX_DARK.soft
    },
    { type: 'separator', margin: 'md', color: '#3a3a3e' },
    {
      type: 'text',
      text: `${props.memberCount} 人在追${memberPreview ? `（${memberPreview}）` : ''}`,
      size: 'sm',
      color: '#bf5af2',
      margin: 'md',
      wrap: true
    }
  ];

  // 如果有投票領先 → 多一行
  if (props.topVote) {
    const voteDateRange = props.topVote.ret_date
      ? `${props.topVote.out_date} – ${props.topVote.ret_date}`
      : `單程 ${props.topVote.out_date}`;
    bodyRows.push({
      type: 'text',
      text: `投票領先：${voteDateRange}（${props.topVote.voteCount} 票）`,
      size: 'xs',
      color: FLEX_DARK.soft,
      wrap: true
    });
  }

  // L1: verdict badge（同 priceIntel 引擎 — 推播與 LIFF 永不打架）
  const verdictMeta = props.verdict ? VERDICT_FLEX_META[props.verdict] : null;

  return {
    type: 'flex',
    altText: `${title}：${formatAirport(props.origin)} → ${formatAirport(props.destination)} NT$ ${props.cheapestPrice.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        contents: [
          {
            type: 'text',
            text: title,
            weight: 'bold',
            size: 'md',
            color: '#ffffff',
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
        backgroundColor: '#bf5af2',
        paddingAll: '16px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        backgroundColor: FLEX_DARK.cardBg,
        contents: bodyRows
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        backgroundColor: FLEX_DARK.cardBg,
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#bf5af2',
            height: 'sm',
            action: {
              type: 'uri',
              label: props.topVote ? '打開投票 / 詳情' : '查看詳情',
              uri: liffUrl
            }
          },
          {
            // 病毒擴散按鈕：群組其他成員看到後一鍵也加入
            // L1: secondary（淺灰底）在深色卡上太突兀 → link style（ghost）
            type: 'button',
            style: 'link',
            height: 'sm',
            action: {
              type: 'uri',
              label: '我也要追',
              uri: liffUrl
            }
          }
        ]
      }
    },
    // metadata：給後續 quota / dedupe 用，subscription-checker 自己讀
    _meta: {
      subscriptionId: props.subscriptionId,
      groupId: props.groupId
    }
  };
}
