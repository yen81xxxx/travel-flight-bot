/**
 * Alert dedupe — 個人訂閱跟使用者有加入的群組訂閱「路線+日期完全一樣」時，
 * 跳過個人 alert（讓群組 flex 用一條 LINE 配額涵蓋）。
 *
 * 為什麼這樣設計：
 *   - 使用者建立個人訂閱 X 後，朋友拉他進有相同 X 群組追蹤的 LINE 群
 *   - 沒 dedupe 時：cron 每天可能同時推「個人 alert」+「群組 alert」 = 2 條 LINE 訊息
 *   - 兩條訊息資訊重複（價格一樣、路線一樣），群組 flex 還更多 context（N 人在追、投票）
 *   - 因此跳個人、保留群組。
 *
 * 為什麼是個人讓位、不是群組讓位：
 *   - 群組 push 一次推給所有成員，不能「對單一成員 selectively skip」(LINE API 限制)
 *   - 個人 push 可以 case by case skip
 *   - 因此邏輯上只能跳個人
 *
 * Trade-off：使用者 lose 了「個人 target 命中」的精確語意 (group flex 寫「群組目標」)。
 *   但 1 條精準 vs 2 條重複，後者騷擾感更大。Net win。
 *
 * 純函數：caller 自己準備好資料（避免在這支拉 DB query / mock 麻煩）。
 */

interface PersonalSubLike {
  source_id: string;          // = LINE userId (Uxxx)
  origin: string;
  destination: string;
  outbound_date: string | null;
  return_date: string | null;
}

interface GroupSubLike {
  id: number;
  origin: string;
  destination: string;
  outbound_date: string | null;
  return_date: string | null;
  active: boolean;
  paused?: boolean;
}

/**
 * @param personalSub 即將推 alert 的個人訂閱
 * @param groupSubs 全部 active group subs (caller 應事先 filter)
 * @param membershipsByUserId map: userId → 該 user 是 member 的 group subscription_ids
 * @returns true = 被 group alert 涵蓋、應該跳過個人 alert
 */
export function isCoveredByGroupAlert(
  personalSub: PersonalSubLike,
  groupSubs: GroupSubLike[],
  membershipsByUserId: Map<string, Set<number>>
): boolean {
  const userMemberships = membershipsByUserId.get(personalSub.source_id);
  if (!userMemberships || userMemberships.size === 0) return false;

  // 沒 outbound_date 的「任何日期」個人訂閱不算被涵蓋 — 它跟任何 group sub 都比不上精確
  // (group sub 的 outbound_date 跟它配不上「任何日期」這個概念)
  if (!personalSub.outbound_date) return false;

  for (const groupSub of groupSubs) {
    if (!userMemberships.has(groupSub.id)) continue;
    if (!groupSub.active) continue;
    if (groupSub.paused) continue;
    // Match 必須 origin + destination + outbound_date + return_date 都一致
    // return_date 可能都是 null (單程訂閱) — null===null 也算一致
    if (groupSub.origin !== personalSub.origin) continue;
    if (groupSub.destination !== personalSub.destination) continue;
    if (groupSub.outbound_date !== personalSub.outbound_date) continue;
    if (groupSub.return_date !== personalSub.return_date) continue;
    return true;
  }
  return false;
}

/**
 * 把 group_member rows 整理成 { userId → Set<group_subscription_id> } map。
 * 抽出來方便單測 + 之後改 schema 時 caller 不用動。
 */
export function buildMembershipMap(
  memberRows: { line_user_id: string; subscription_id: number }[]
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const m of memberRows) {
    let set = map.get(m.line_user_id);
    if (!set) {
      set = new Set();
      map.set(m.line_user_id, set);
    }
    set.add(m.subscription_id);
  }
  return map;
}
