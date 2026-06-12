import type { WebhookEvent } from '@line/bot-sdk';
import { getSourceId, pushText, replyText, replyFlex } from './line';
import { getState, setState, resetState } from './state';
import { searchFlights } from './serpapi';
import { analyzeFlights, formatAnalysisForLine } from './flights';
import { getSupabase } from './supabase';
import { buildHistoryFlex } from './flex-message';
import { getAirlineCategory, type AirlineCategory } from '@/config/airlines';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://travel-flight-bot.vercel.app';

// ===== 提示文本 =====
const HELP_TEXT = [
  '✈️ 機票查詢機器人',
  '',
  '指令：',
  '・「查航班」→ 開新查詢（選地點、日期）',
  '・「我的訂閱」→ 看降價提醒清單',
  '・「設定」→ 通知靜音時段等',
  '・「說明」→ 顯示這份說明',
  '',
  '💡 提示：在搜尋結果頁可以「訂閱降價提醒」'
].join('\n');

const JOIN_TEXT = [
  '👋 哈囉，我是機票小助手！',
  '',
  '在群組裡可以一起追蹤同一條航線、共享降價提醒。',
  '',
  '輸入「查航班」開始'
].join('\n');

const ASK_DATE_TEXT = [
  '請輸入去程與回程日期',
  '',
  '格式：YYYY-MM-DD YYYY-MM-DD',
  '範例：2027-02-15 2027-02-18',
  '',
  '輸入「取消」可中止查詢'
].join('\n');

const CANCEL_TEXT = '已取消查詢。輸入「查航班」可重新開始。';
const INVALID_DATE_FORMAT_TEXT = '日期格式不正確。請輸入：YYYY-MM-DD YYYY-MM-DD\n範例：2027-02-15 2027-02-18\n\n輸入「取消」可中止。';
const INVALID_DATE_RANGE_TEXT = '回程日期必須晚於去程日期，請重新輸入。';
const SEARCH_STARTED_TEXT = (outbound: string, ret: string) => `🔍 正在查詢 ${outbound} ~ ${ret} 的航班，稍候...`;
const SEARCH_FAILED_TEXT = '❌ 查詢失敗，請稍後再試。';

// ===== 命令常量 =====
const COMMANDS = {
  CANCEL: ['取消', 'cancel'],
  HELP: ['說明', '幫助', 'help', '/help'],
  SETTINGS: ['設定', '通知設定', '/settings'],
  SUBSCRIPTIONS: ['我的訂閱', '訂閱', '/subs'],
  SEARCH: ['查航班', '查機票', '/search']
} as const;

// ===== 正規表達式 =====
const DATE_FORMAT = /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/;

/**
 * 判斷 sourceId 是否為群組 / 聊天室
 */
function isGroupOrRoom(sourceId: string): boolean {
  return sourceId.startsWith('C') || sourceId.startsWith('R');
}

/**
 * 判斷文本是否匹配命令（支持大小寫無關）
 */
function matchesCommand(text: string, commandList: readonly string[]): boolean {
  return commandList.includes(text) || commandList.includes(text.toLowerCase());
}

function buildLiffUrl(): string | null {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
  if (!liffId) return null;
  return `https://liff.line.me/${liffId}`;
}

function getSubscriptionsUrl(): string {
  // 訂閱頁是普通網頁；在 LINE 內會用 in-app browser 開啟，仍可取得 LIFF profile
  return `${APP_URL}/liff/subscriptions`;
}

/**
 * 處理 postback 事件（多訂閱卡片每列點下去 → 查歷史走勢）
 */
async function handlePostback(event: WebhookEvent): Promise<void> {
  if (event.type !== 'postback') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dataStr = (event as any).postback?.data as string | undefined;
  const replyToken = (event as { replyToken?: string }).replyToken;
  if (!dataStr || !replyToken) return;

  const params = new URLSearchParams(dataStr);
  const action = params.get('a');
  if (action !== 'h') return;  // 未知 action 暫不處理

  const origin = params.get('o');
  const destination = params.get('d');
  const outboundDate = params.get('out');
  const returnDate = params.get('ret');
  const max = params.get('max');
  const cat = params.get('cat') as AirlineCategory | null;
  const winAirport = params.get('win');

  if (!origin || !destination || !outboundDate || !returnDate || !max || !cat || !winAirport) {
    await replyText(replyToken, '⚠️ 歷史查詢參數不完整');
    return;
  }

  try {
    // 同城所有機場（東京 = HND + NRT）一起撈
    const { getCityAirports } = await import('@/config/airports');
    const allAirports = getCityAirports(destination);
    // 按分類分別撈歷史最低，跨機場以 min 合併
    const perAirport = await Promise.all(
      allAirports.map(a => fetchHistoryByCategory(origin, a, outboundDate, returnDate, 30))
    );
    const lccByDay = new Map<string, number>();
    const tradByDay = new Map<string, number>();
    for (const result of perAirport) {
      for (const p of result.lcc) {
        const prev = lccByDay.get(p.date);
        if (prev == null || p.minPrice < prev) lccByDay.set(p.date, p.minPrice);
      }
      for (const p of result.traditional) {
        const prev = tradByDay.get(p.date);
        if (prev == null || p.minPrice < prev) tradByDay.set(p.date, p.minPrice);
      }
    }
    const sortByDate = (m: Map<string, number>) =>
      Array.from(m.entries()).map(([date, minPrice]) => ({ date, minPrice }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // R4-A: 新歷史卡單一 CTA（打開 Travl）— Skyscanner 留在達標卡（spec A4/C）
    const flex = buildHistoryFlex({
      origin,
      destination,
      outboundDate,
      returnDate,
      lccPoints: sortByDate(lccByDay),
      tradPoints: sortByDate(tradByDay),
      threshold: Number(max)
    });
    await replyFlex(replyToken, flex);
  } catch (err) {
    console.error('[bot-handler] postback history failed:', err);
    try { await replyText(replyToken, '❌ 查詢歷史失敗，請稍後再試'); } catch { /* ignore */ }
  }
}

/**
 * 直接查 DB 按分類撈每日最低價（LCC + Traditional 各一份）。
 * trip_leg 的考量：
 *  - 廉航：用 return list（== pickLccCombo 來源，精確 combo 來回價）
 *  - 傳統：用 outbound list（== pickTraditionalSameAirline 來源，同家來回估算）
 *  - 跟 cron 的 queryPreviousCategoryMins 邏輯一致，避免比錯對象
 */
async function fetchHistoryByCategory(
  origin: string,
  destination: string,
  outboundDate: string,
  returnDate: string,
  days: number
): Promise<{
  lcc: { date: string; minPrice: number }[];
  traditional: { date: string; minPrice: number }[];
}> {
  const supabase = getSupabase();
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await supabase
    .from('flight_quotes')
    .select('queried_at, price, airline, trip_leg')
    .eq('origin', origin)
    .eq('destination', destination)
    .eq('outbound_date', outboundDate)
    .eq('return_date', returnDate)
    .eq('stops', 0)
    .gte('queried_at', since)
    .not('price', 'is', null);
  if (!data) return { lcc: [], traditional: [] };

  const lccByDay = new Map<string, number[]>();
  const tradByDay = new Map<string, number[]>();
  for (const r of data as { queried_at: string; price: number; airline: string | null; trip_leg: string }[]) {
    if (r.price == null) continue;
    const cat = getAirlineCategory(r.airline);
    if (cat == null) continue;
    const day = r.queried_at.slice(0, 10);
    if (cat === 'lcc' && r.trip_leg === 'return') {
      const arr = lccByDay.get(day) ?? [];
      arr.push(Number(r.price));
      lccByDay.set(day, arr);
    } else if (cat === 'full-service' && r.trip_leg === 'outbound') {
      const arr = tradByDay.get(day) ?? [];
      arr.push(Number(r.price));
      tradByDay.set(day, arr);
    }
  }

  const toPoints = (m: Map<string, number[]>) =>
    Array.from(m.entries())
      .map(([date, prices]) => ({ date, minPrice: Math.min(...prices) }))
      .sort((a, b) => a.date.localeCompare(b.date));

  return { lcc: toPoints(lccByDay), traditional: toPoints(tradByDay) };
}

export async function handleEvent(event: WebhookEvent): Promise<void> {
  // Postback：多訂閱卡片點某列 → 回歷史走勢卡片
  if (event.type === 'postback') {
    await handlePostback(event);
    return;
  }

  // 群組/聊天室加入時打招呼
  if (event.type === 'join') {
    const replyToken = (event as { replyToken?: string }).replyToken;
    if (replyToken) {
      await replyText(replyToken, JOIN_TEXT);
    }
    return;
  }

  // bot 被踢出群組/聊天室 → 軟刪除該 source 所有 active 訂閱（避免 cron 繼續浪費 SerpApi 配額）
  if (event.type === 'leave') {
    const leftSourceId = getSourceId(event);
    if (leftSourceId) {
      try {
        const supabase = getSupabase();
        const { error } = await supabase
          .from('subscriptions')
          .update({ active: false })
          .eq('source_id', leftSourceId)
          .eq('active', true);
        if (error) {
          console.error('[bot-handler] leave cleanup failed:', error);
        } else {
          console.log('[bot-handler] cleaned subs for left source:', leftSourceId);
        }
      } catch (err) {
        console.error('[bot-handler] leave cleanup exception:', err);
      }
    }
    return;
  }

  if (event.type !== 'message') return;
  if (event.message.type !== 'text') return;

  const text = event.message.text.trim();
  const sourceId = getSourceId(event);
  if (!sourceId) return;

  const replyToken = event.replyToken;
  const state = await getState(sourceId);

  // 取消查詢
  if (matchesCommand(text, COMMANDS.CANCEL)) {
    await resetState(sourceId);
    await replyText(replyToken, CANCEL_TEXT);
    return;
  }

  // 說明 / 幫助
  if (matchesCommand(text, COMMANDS.HELP)) {
    await replyText(replyToken, HELP_TEXT);
    return;
  }

  // 通知設定
  // 個人 (U) / 群組 (C) / 聊天室 (R) 統一直達 /liff/settings?ctx=sourceId
  // SettingsView 看到 ctx 會跳過 LIFF OAuth → 不會卡在 access.line.me 400、不會被 token 過期影響
  if (matchesCommand(text, COMMANDS.SETTINGS)) {
    const isGroup = isGroupOrRoom(sourceId);
    const url = `${APP_URL}/liff/settings?ctx=${encodeURIComponent(sourceId)}`;
    await replyText(
      replyToken,
      [
        '⚙️ 通知設定',
        isGroup ? '（這是「此群組」的設定，個人設定請到 1:1 視窗）' : '（每日摘要、降價提醒、靜音時段）',
        '',
        url
      ].join('\n')
    );
    return;
  }

  // 我的訂閱
  if (matchesCommand(text, COMMANDS.SUBSCRIPTIONS)) {
    const sourceType = event.source?.type ?? 'unknown';
    const isGroup = isGroupOrRoom(sourceId);
    const url = isGroup
      ? `${getSubscriptionsUrl()}?ctx=${encodeURIComponent(sourceId)}`
      : getSubscriptionsUrl();
    console.log('[bot] 我的訂閱', { sourceType, sourceIdPrefix: sourceId.slice(0, 1), isGroup, urlHasCtx: url.includes('ctx=') });
    const lines = [
      '🔔 點下面連結查看訂閱',
      isGroup
        ? '會看到「個人訂閱 + 此群組訂閱」'
        : '可以在這裡查看、改金額、取消',
      '',
      url
    ];
    if (!isGroup) {
      lines.push('');
      lines.push('💡 想看「群組訂閱」？請到該 LINE 群組裡再傳一次「我的訂閱」（這條訊息看不到群組的訂閱）');
    }
    await replyText(replyToken, lines.join('\n'));
    return;
  }

  // 進入查詢流程
  if (matchesCommand(text, COMMANDS.SEARCH)) {
    const liffUrl = buildLiffUrl();
    if (liffUrl) {
      // 在群組裡點 LIFF 連結時，附帶 ctx=<sourceId>，讓 LIFF 可以提供「訂閱給群組」選項
      const isGroup = isGroupOrRoom(sourceId);
      const urlWithCtx = isGroup
        ? `${liffUrl}?ctx=${encodeURIComponent(sourceId)}`
        : liffUrl;
      await replyText(
        replyToken,
        [
          '✈️ 點下面連結開啟查詢頁',
          isGroup
            ? '可選擇訂閱給「我自己」或「整個群組」'
            : '可選擇出發地、目的地、日期，並訂閱降價提醒',
          '',
          urlWithCtx
        ].join('\n')
      );
    } else {
      await setState({ source_id: sourceId, state: 'waiting_date', context: {} });
      await replyText(replyToken, ASK_DATE_TEXT);
    }
    return;
  }

  // 等待日期輸入中
  if (state.state === 'waiting_date') {
    const m = text.match(DATE_FORMAT);
    if (!m) {
      await replyText(replyToken, INVALID_DATE_FORMAT_TEXT);
      return;
    }

    const outboundDate = m[1];
    const returnDate = m[2];

    if (new Date(outboundDate) >= new Date(returnDate)) {
      await replyText(replyToken, INVALID_DATE_RANGE_TEXT);
      return;
    }

    await resetState(sourceId);
    await replyText(replyToken, SEARCH_STARTED_TEXT(outboundDate, returnDate));
    await runSearchAndPush(sourceId, outboundDate, returnDate, 'line');
    return;
  }

  // 預設：在群組裡不亂回應，僅 user 1:1 才送 help
  if (!isGroupOrRoom(sourceId)) {
    await replyText(replyToken, HELP_TEXT);
  }
}

async function runSearchAndPush(
  sourceId: string,
  outboundDate: string,
  returnDate: string,
  triggeredBy: 'line' | 'cron' | 'manual'
): Promise<void> {
  const origin = process.env.DEFAULT_ORIGIN ?? 'TPE';
  const destination = process.env.DEFAULT_DESTINATION ?? 'HND';
  const supabase = getSupabase();

  const startedAt = new Date();
  const { data: runRow } = await supabase
    .from('search_runs')
    .insert({
      triggered_by: triggeredBy,
      source_id: sourceId,
      origin,
      destination,
      outbound_date: outboundDate,
      return_date: returnDate,
      status: 'success',
      started_at: startedAt.toISOString()
    })
    .select()
    .single();

  try {
    const result = await searchFlights({
      origin,
      destination,
      outboundDate,
      returnDate
    });

    const analysis = analyzeFlights(result.outbound, result.return);
    const text = formatAnalysisForLine(
      analysis,
      outboundDate,
      returnDate,
      origin,
      destination
    );

    await pushText(sourceId, text);

    if (runRow?.id) {
      await supabase
        .from('search_runs')
        .update({
          status: result.fromCache ? 'cached' : 'success',
          serpapi_calls: result.serpapiCalls,
          duration_ms: Date.now() - startedAt.getTime(),
          finished_at: new Date().toISOString()
        })
        .eq('id', runRow.id);
    }
  } catch (err) {
    console.error('[bot-handler] search failed:', err);
    if (runRow?.id) {
      await supabase
        .from('search_runs')
        .update({
          status: 'failed',
          error_message: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - startedAt.getTime(),
          finished_at: new Date().toISOString()
        })
        .eq('id', runRow.id);
    }
    try {
      await pushText(sourceId, SEARCH_FAILED_TEXT);
    } catch {}
  }
}
