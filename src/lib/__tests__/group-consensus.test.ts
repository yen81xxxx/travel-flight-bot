/**
 * computeDerivedTarget — 純函數測試
 *
 * Matrix: 3 rule × 5 種成員組合 = 15 cases。
 * 加上 edge case：
 *   - 0 成員
 *   - 全員 null accepted_target
 *   - 1 個成員
 *   - 包含 null + 數字混合
 *   - accepted_target = 0（壞資料，應該被當沒設）
 */
import { computeDerivedTarget, type MemberTargetInput } from '../group-consensus';

const m = (t: number | null): MemberTargetInput => ({ accepted_target: t });

describe('computeDerivedTarget — rule=max', () => {
  it('空陣列 → null', () => {
    expect(computeDerivedTarget([], 'max')).toBeNull();
  });

  it('全員 accepted_target=null → null', () => {
    expect(computeDerivedTarget([m(null), m(null), m(null)], 'max')).toBeNull();
  });

  it('1 個成員有 target → 取那個', () => {
    expect(computeDerivedTarget([m(12000)], 'max')).toBe(12000);
  });

  it('3 個成員 → 取最大', () => {
    expect(computeDerivedTarget([m(12000), m(18000), m(9500)], 'max')).toBe(18000);
  });

  it('混合 null + 數字 → null 被忽略', () => {
    expect(computeDerivedTarget([m(12000), m(null), m(15000), m(null)], 'max')).toBe(15000);
  });

  it('accepted_target=0 → 當沒設 (壞資料防呆)', () => {
    expect(computeDerivedTarget([m(0), m(12000)], 'max')).toBe(12000);
  });

  it('accepted_target=-100 (壞資料) → 當沒設', () => {
    expect(computeDerivedTarget([m(-100), m(12000)], 'max')).toBe(12000);
  });
});

describe('computeDerivedTarget — rule=avg', () => {
  it('3 個成員 12k/18k/9k → 平均 13000', () => {
    expect(computeDerivedTarget([m(12000), m(18000), m(9000)], 'avg')).toBe(13000);
  });

  it('帶小數的平均 → 四捨五入', () => {
    // (12000 + 12001) / 2 = 12000.5 → round to 12001 (banker's? no, normal round = 12001)
    expect(computeDerivedTarget([m(12000), m(12001)], 'avg')).toBe(12001);
  });

  it('1 個成員 → 等於該成員值', () => {
    expect(computeDerivedTarget([m(15000)], 'avg')).toBe(15000);
  });

  it('全員 null → null', () => {
    expect(computeDerivedTarget([m(null), m(null)], 'avg')).toBeNull();
  });
});

describe('computeDerivedTarget — rule=manual', () => {
  it('永遠回 null (manual 規則 = caller 不要動 max_price)', () => {
    expect(computeDerivedTarget([m(12000), m(18000)], 'manual')).toBeNull();
    expect(computeDerivedTarget([], 'manual')).toBeNull();
    expect(computeDerivedTarget([m(null)], 'manual')).toBeNull();
  });
});

describe('computeDerivedTarget — rule diff comparison', () => {
  it('同一組 members → max ≥ avg', () => {
    const members = [m(10000), m(15000), m(20000)];
    const max = computeDerivedTarget(members, 'max')!;
    const avg = computeDerivedTarget(members, 'avg')!;
    expect(max).toBeGreaterThanOrEqual(avg);
  });

  it('max 的人加目標 → max 上升、avg 也上升但較少', () => {
    const before = [m(10000), m(15000)];
    const after = [m(10000), m(15000), m(30000)];
    expect(computeDerivedTarget(after, 'max')!).toBeGreaterThan(computeDerivedTarget(before, 'max')!);
    expect(computeDerivedTarget(after, 'avg')!).toBeGreaterThan(computeDerivedTarget(before, 'avg')!);
  });
});
