/**
 * Group consensus 算 derived_target — 純函數。
 *
 * 規則由 subscriptions.consensus_rule 決定（G0 加的欄位）：
 *   - 'max'    = 所有 accepted_target 取最大（沒人會被坑、預設）
 *   - 'avg'    = 所有 accepted_target 取平均（四捨五入到整數，因為機票是整數）
 *   - 'manual' = 不算共識，回 null → caller 不要 update subscriptions.max_price
 *
 * 抽純函數的好處：
 *   - 可單測（rule × 成員組合的矩陣不會 silent broke）
 *   - 改規則 / 加新規則時，所有 caller 自動跟著走（endpoint / cron / push）
 *
 * G2 user 拍板：rule = 'max'，visibility 全公開。但本檔仍支援 avg 跟 manual，
 * 之後改 rule 不用動 caller。
 */

export type ConsensusRule = 'max' | 'avg' | 'manual';

export interface MemberTargetInput {
  accepted_target: number | null;
}

/**
 * 算群組的 derived target。
 *
 * @returns 算得出來的 derived_target；如果是 'manual' 或全員都 null → null
 *          （caller 收到 null 時不應更新 subscriptions.max_price）
 */
export function computeDerivedTarget(
  members: MemberTargetInput[],
  rule: ConsensusRule
): number | null {
  if (rule === 'manual') return null;

  // 過濾出有設 accepted_target 的成員（null = 還沒表態）
  const targets = members
    .map(m => m.accepted_target)
    .filter((t): t is number => t != null && t > 0);

  if (targets.length === 0) return null;

  if (rule === 'max') {
    return Math.max(...targets);
  }

  // 'avg' — 機票是整數，四捨五入避免小數
  const sum = targets.reduce((a, b) => a + b, 0);
  return Math.round(sum / targets.length);
}

/**
 * #5: 決定要寫回 subscriptions.max_price 的有效目標。
 *   - derived 有值（有人設目標）→ 用 derived
 *   - derived=null（全員離開 / 沒人設目標 / rule=manual）→ 還原 base（建立者原始門檻）
 *   - 兩者都 null（舊資料未回填 base）→ null，caller 不寫回（保險、不亂改）
 * 修掉「最後一人離開後 max_price 卡在舊共識值」的 bug。純函數方便單測。
 */
export function resolveEffectiveTarget(
  derived: number | null,
  base: number | null
): number | null {
  if (derived != null) return derived;
  return base ?? null;
}
