import type { WebhookEvent } from '@line/bot-sdk';
import { getSourceId, pushText, replyText } from './line';
import { getState, setState, resetState } from './state';
import { searchFlights } from './serpapi';
import { analyzeFlights, formatAnalysisForLine } from './flights';
import { getSupabase } from './supabase';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://travel-flight-bot.vercel.app';

const HELP_TEXT = [
  '✈️ 機票查詢機器人',
  '',
  '指令：',
  '・「查航班」→ 開新查詢（選地點、日期）',
  '・「我的訂閱」→ 看降價提醒清單',
  '・「說明」→ 顯示這份說明',
  '',
  '💡 提示：在搜尋結果頁可以「訂閱降價提醒」'
].join('\n');

const ASK_DATE_TEXT = [
  '請輸入去程與回程日期',
  '',
  '格式：YYYY-MM-DD YYYY-MM-DD',
  '範例：2027-02-15 2027-02-18',
  '',
  '輸入「取消」可中止查詢'
].join('\n');

const DATE_FORMAT = /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/;

function buildLiffUrl(): string | null {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
  if (!liffId) return null;
  return `https://liff.line.me/${liffId}`;
}

function getSubscriptionsUrl(): string {
  // 訂閱頁是普通網頁；在 LINE 內會用 in-app browser 開啟，仍可取得 LIFF profile
  return `${APP_URL}/liff/subscriptions`;
}

export async function handleEvent(event: WebhookEvent): Promise<void> {
  // 群組/聊天室加入時打招呼
  if (event.type === 'join') {
    const replyToken = (event as any).replyToken;
    if (replyToken) {
      await replyText(
        replyToken,
        [
          '👋 哈囉，我是機票小助手！',
          '',
          '在群組裡可以一起追蹤同一條航線、共享降價提醒。',
          '',
          '輸入「查航班」開始'
        ].join('\n')
      );
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
  if (text === '取消' || text.toLowerCase() === 'cancel') {
    await resetState(sourceId);
    await replyText(replyToken, '已取消查詢。輸入「查航班」可重新開始。');
    return;
  }

  // 說明 / 幫助
  if (text === '說明' || text === '幫助' || text === 'help' || text === '/help') {
    await replyText(replyToken, HELP_TEXT);
    return;
  }

  // 我的訂閱
  if (text === '我的訂閱' || text === '訂閱' || text === '/subs') {
    await replyText(
      replyToken,
      [
        '🔔 點下面連結查看你的降價提醒清單',
        '',
        getSubscriptionsUrl(),
        '',
        '可以在這裡查看、取消訂閱'
      ].join('\n')
    );
    return;
  }

  // 進入查詢流程
  if (text === '查航班' || text === '查機票' || text === '/search') {
    const liffUrl = buildLiffUrl();
    if (liffUrl) {
      // 在群組裡點 LIFF 連結時，附帶 ctx=<sourceId>，讓 LIFF 可以提供「訂閱給群組」選項
      const isGroup = sourceId.startsWith('C') || sourceId.startsWith('R');
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
      await replyText(
        replyToken,
        '日期格式不正確。請輸入：YYYY-MM-DD YYYY-MM-DD\n範例：2027-02-15 2027-02-18\n\n輸入「取消」可中止。'
      );
      return;
    }

    const outboundDate = m[1];
    const returnDate = m[2];

    if (new Date(outboundDate) >= new Date(returnDate)) {
      await replyText(replyToken, '回程日期必須晚於去程日期，請重新輸入。');
      return;
    }

    await resetState(sourceId);
    await replyText(replyToken, `🔍 正在查詢 ${outboundDate} ~ ${returnDate} 的航班，稍候...`);
    await runSearchAndPush(sourceId, outboundDate, returnDate, 'line');
    return;
  }

  // 預設：在群組裡不亂回應，僅 user 1:1 才送 help
  const isGroup = sourceId.startsWith('C') || sourceId.startsWith('R');
  if (!isGroup) {
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
      await pushText(sourceId, '❌ 查詢失敗，請稍後再試。');
    } catch (_e) {}
  }
}
