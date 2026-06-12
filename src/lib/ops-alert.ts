/**
 * ops-alert — cron 異常時推一則文字給 admin（R4-B）
 *
 * 為什麼需要：SerpApi 全 key 爆掉 / LINE 推播失敗時只寫 log，
 * admin 要自己發現「今天怎麼沒摘要」。改成主動告警 — 燒 1 則
 * LINE 配額換可觀測性（user 核可的取捨）。
 *
 * 防轟炸：同一天只告警一次 — 用 search_runs 既有資料判斷
 * （今天稍早已有非 success 的 run = 已經告警過 → skip），不加 schema。
 *
 * 告警對象：LINE_DAILY_PUSH_TARGET（admin 自己）。未設 → 只 log。
 */
import { pushText } from './line';

export interface OpsAlertSignals {
  /** SerpApi 全部 key 今日配額用盡（cron 或 sub-checker 任一邊） */
  allKeysExhausted: boolean;
  /** 每日摘要 push 失敗數 */
  pushedFail: number;
  /** sub-checker 錯誤數（個別訂閱失敗 — 只在搭配其他訊號時列出，單獨不觸發） */
  subErrors: number;
}

/** 要不要發告警 — 純函數。只看系統性訊號（個別訂閱錯誤太吵，不單獨觸發）。 */
export function shouldSendOpsAlert(s: OpsAlertSignals): boolean {
  return s.allKeysExhausted || s.pushedFail > 0;
}

/** 告警文案 — 零 emoji、【】結構（同 A5 語言）。純函數可測。 */
export function buildOpsAlertText(s: OpsAlertSignals, dateStr: string): string {
  const lines = [`【系統告警】Travl cron 異常（${dateStr}）`];
  if (s.allKeysExhausted) {
    lines.push('SerpApi 全部 key 今日配額用盡，部分路線未查價。');
  }
  if (s.pushedFail > 0) {
    lines.push(`每日摘要推播失敗 ${s.pushedFail} 則（多半是 LINE 配額或 token 問題）。`);
  }
  if (s.subErrors > 0) {
    lines.push(`另有 ${s.subErrors} 筆訂閱檢查錯誤（詳見 Vercel logs）。`);
  }
  lines.push('今日通知可能不完整；配額類問題明日重置後自動恢復。');
  return lines.join('\n');
}

/**
 * dedup + 發送。回傳實際有沒有發（測試 / cron response 觀察用）。
 *
 * dedup 查詢在「本次 run 的 search_runs row 寫入之後」執行 — 所以條件是
 * 「今天有 ≥2 筆非 success」＝之前已有失敗（已告警過）→ 本次 skip。
 */
export async function sendOpsAlertIfNeeded(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  signals: OpsAlertSignals
): Promise<{ sent: boolean; reason: string }> {
  if (!shouldSendOpsAlert(signals)) return { sent: false, reason: 'no-signal' };

  const admin = process.env.LINE_DAILY_PUSH_TARGET?.trim();
  if (!admin) {
    console.warn('[ops-alert] LINE_DAILY_PUSH_TARGET 未設 — 告警只進 log:', signals);
    return { sent: false, reason: 'no-admin-target' };
  }

  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await supabase
      .from('search_runs')
      .select('id')
      .gte('started_at', `${today}T00:00:00Z`)
      .neq('status', 'success')
      .limit(2);
    if ((data ?? []).length >= 2) {
      return { sent: false, reason: 'already-alerted-today' };
    }
  } catch (e) {
    // dedup 查不到就寧可多發一次也不漏發（fail loud 優先）
    console.warn('[ops-alert] dedup query failed, sending anyway:', e);
  }

  try {
    await pushText(admin, buildOpsAlertText(signals, today));
    return { sent: true, reason: 'sent' };
  } catch (e) {
    // 告警本身失敗（極可能 LINE 配額也爆了）— log 完不丟，cron 不能因告警死掉
    console.error('[ops-alert] send failed:', e);
    return { sent: false, reason: 'push-failed' };
  }
}
