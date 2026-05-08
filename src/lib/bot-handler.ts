import type { WebhookEvent } from '@line/bot-sdk';
import { getSourceId, pushText, replyText } from './line';
import { getState, setState, resetState } from './state';
import { searchFlights } from './serpapi';
import { analyzeFlights, formatAnalysisForLine } from './flights';
import { getSupabase } from './supabase';

const HELP_TEXT = [
  '✈️ 機票查詢機器人',
  '',
  '輸入「查航班」開始搜尋',
  '可選擇出發地、目的地、日期'
].join('\n');

const ASK_DATE_TEXT = [
  '請輸入去程與回程日期',
  '',
  '格式：YYYY-MM-DD YYYY-MM-DD',
  '範例：2027-02-15 2027-02-18',
  '',
  '搜尋條件：',
  '・星宇 / 長榮 / 虎航 / 捷星 / 酷航',
  '',
  '輸入「取消」可中止查詢'
].join('\n');

function buildLiffUrl(): string | null {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
  if (!liffId) return null;
  return `https://liff.line.me/${liffId}`;
}

const DATE_FORMAT = /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/;

/**
 * 主入口：處理單一 LINE webhook event
 */
export async function handleEvent(event: WebhookEvent): Promise<void> {
  if (event.type !== 'message') return;
  if (event.message.type !== 'text') return;

  const text = event.message.text.trim();
  const sourceId = getSourceId(event);
  if (!sourceId) return;

  const replyToken = event.replyToken;
  const state = await getState(sourceId);

  // 共通：取消
  if (text === '取消' || text.toLowerCase() === 'cancel') {
    await resetState(sourceId);
    await replyText(replyToken, '已取消查詢。輸入「查航班」可重新開始。');
    return;
  }

  // 進入查詢流程
  if (text === '查航班' || text === '查機票' || text === '/search') {
    const liffUrl = buildLiffUrl();
    if (liffUrl) {
      // 有 LIFF：直接給連結，可選擇地點 + 日期
      await replyText(
        replyToken,
        [
          '✈️ 點下面連結開啟查詢頁',
          '可選擇出發地、目的地、日期',
          '',
          liffUrl
        ].join('\n')
      );
    } else {
      // 沒設定 LIFF：fall back 到純文字日期輸入
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

    // 重置狀態 — 接下來開始查詢，回應一個「處理中」訊息，背景再去 push 結果
    await resetState(sourceId);
    await replyText(replyToken, `🔍 正在查詢 ${outboundDate} ~ ${returnDate} 的航班，稍候...`);

    // 用 await 但不擋 reply（reply 已先發出）
    await runSearchAndPush(sourceId, outboundDate, returnDate, 'line');
    return;
  }

  // 預設：show help
  await replyText(replyToken, HELP_TEXT);
}

/**
 * 執行搜尋並推 push 訊息給觸發者
 */
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

    // push 給觸發者（reply token 已用過，所以走 push）
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
    } catch (_e) {
      // ignore push error
    }
  }
}
