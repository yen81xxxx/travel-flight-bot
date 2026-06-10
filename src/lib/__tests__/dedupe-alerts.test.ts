/**
 * dedupe-alerts — pure function 測試矩陣
 *
 * 關鍵 case：
 *   ✓ 同 user 同路線同日期 + member → 跳
 *   ✗ 同 user 同路線、不同日期 → 不跳
 *   ✗ 不是 member → 不跳
 *   ✗ group sub paused → 不跳（被 group 隱蔽地涵蓋是 bug）
 *   ✗ outbound_date=null (任何日期型訂閱) → 不跳
 *   ✓ 單程 (return_date 都 null) → 算一致
 *   ✗ 一邊單程一邊往返 → 不跳
 */
import { isCoveredByGroupAlert, buildMembershipMap } from '../dedupe-alerts';

const personalTPEtoNRT = {
  source_id: 'Uabc',
  origin: 'TPE',
  destination: 'NRT',
  outbound_date: '2026-08-14',
  return_date: '2026-08-18'
};

const mkGroupSub = (overrides: Partial<{
  id: number; origin: string; destination: string;
  outbound_date: string | null; return_date: string | null;
  active: boolean; paused: boolean;
}> = {}) => ({
  id: 100,
  origin: 'TPE',
  destination: 'NRT',
  outbound_date: '2026-08-14',
  return_date: '2026-08-18',
  active: true,
  paused: false,
  ...overrides
});

const memberOf = (userId: string, subIds: number[]) =>
  new Map([[userId, new Set(subIds)]]);

describe('isCoveredByGroupAlert — 正面 case', () => {
  it('同路線同日期 + caller 是 member → true', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [mkGroupSub()],
      memberOf('Uabc', [100])
    )).toBe(true);
  });

  it('多個 group sub 中有一個 match → true (找到就停)', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [
        mkGroupSub({ id: 99, destination: 'KIX' }),  // 不 match
        mkGroupSub({ id: 100 })                      // match
      ],
      memberOf('Uabc', [99, 100])
    )).toBe(true);
  });

  it('單程個人 + 單程群組（return_date 都 null）→ true', () => {
    expect(isCoveredByGroupAlert(
      { ...personalTPEtoNRT, return_date: null },
      [mkGroupSub({ return_date: null })],
      memberOf('Uabc', [100])
    )).toBe(true);
  });
});

describe('isCoveredByGroupAlert — 不該跳的 case', () => {
  it('caller 不是 member → false', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [mkGroupSub()],
      new Map()
    )).toBe(false);
  });

  it('caller 是 member 但不是這個 group → false', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [mkGroupSub({ id: 100 })],
      memberOf('Uabc', [999])  // member of 999, 不是 100
    )).toBe(false);
  });

  it('路線不同 (destination) → false', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [mkGroupSub({ destination: 'KIX' })],
      memberOf('Uabc', [100])
    )).toBe(false);
  });

  it('出發日不同 → false', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [mkGroupSub({ outbound_date: '2026-09-14' })],
      memberOf('Uabc', [100])
    )).toBe(false);
  });

  it('回程日不同 → false', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [mkGroupSub({ return_date: '2026-08-21' })],
      memberOf('Uabc', [100])
    )).toBe(false);
  });

  it('group sub paused → false (sub-checker loop 不會推這條，個人也不該跳)', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [mkGroupSub({ paused: true })],
      memberOf('Uabc', [100])
    )).toBe(false);
  });

  it('group sub inactive → false', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [mkGroupSub({ active: false })],
      memberOf('Uabc', [100])
    )).toBe(false);
  });

  it('個人訂閱沒 outbound_date (任何日期型) → false', () => {
    expect(isCoveredByGroupAlert(
      { ...personalTPEtoNRT, outbound_date: null },
      [mkGroupSub()],
      memberOf('Uabc', [100])
    )).toBe(false);
  });

  it('個人單程 vs 群組往返 → false', () => {
    expect(isCoveredByGroupAlert(
      { ...personalTPEtoNRT, return_date: null },
      [mkGroupSub({ return_date: '2026-08-18' })],  // 群組是往返
      memberOf('Uabc', [100])
    )).toBe(false);
  });

  it('個人往返 vs 群組單程 → false', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [mkGroupSub({ return_date: null })],
      memberOf('Uabc', [100])
    )).toBe(false);
  });

  it('groupSubs 空陣列 → false (沒有 group 可比)', () => {
    expect(isCoveredByGroupAlert(
      personalTPEtoNRT,
      [],
      memberOf('Uabc', [100])
    )).toBe(false);
  });
});

describe('buildMembershipMap', () => {
  it('空輸入 → 空 map', () => {
    expect(buildMembershipMap([]).size).toBe(0);
  });

  it('單一 user 多筆 sub', () => {
    const m = buildMembershipMap([
      { line_user_id: 'Uabc', subscription_id: 1 },
      { line_user_id: 'Uabc', subscription_id: 2 },
      { line_user_id: 'Uabc', subscription_id: 3 }
    ]);
    expect(m.get('Uabc')).toEqual(new Set([1, 2, 3]));
  });

  it('多 user', () => {
    const m = buildMembershipMap([
      { line_user_id: 'Uabc', subscription_id: 1 },
      { line_user_id: 'Uxyz', subscription_id: 2 }
    ]);
    expect(m.get('Uabc')).toEqual(new Set([1]));
    expect(m.get('Uxyz')).toEqual(new Set([2]));
  });

  it('重複 row (理論上 unique 擋住但保險) → 同 Set 不會重複', () => {
    const m = buildMembershipMap([
      { line_user_id: 'Uabc', subscription_id: 1 },
      { line_user_id: 'Uabc', subscription_id: 1 }
    ]);
    expect(m.get('Uabc')?.size).toBe(1);
  });
});
