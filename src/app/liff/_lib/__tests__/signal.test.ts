/**
 * deriveSignal — 三個門檻邊界 + SIGNAL_META 結構穩定性
 *
 * 這個邏輯有兩個踩雷風險：
 *   1. 門檻寫反（< vs <=）— 目標 12800 / current 12800 該 hit 還是 near?
 *      handoff README §4.2 明確: 「currentBest <= target → hit」 → 等於要 hit
 *   2. 1.08 的浮點誤差 — 目標 100 / current 108 是 near，current 108.0001 是 watching
 *
 * 改門檻數值（1.08）要同步更新手冊，不要 silent drift。
 */
import { deriveSignal, SIGNAL_META, type Signal } from '../signal';

describe('deriveSignal — threshold semantics', () => {
  it('當前價低於目標 → hit', () => {
    expect(deriveSignal(11000, 12800)).toBe('hit');
  });

  it('當前價剛好等於目標 → hit（邊界包含）', () => {
    expect(deriveSignal(12800, 12800)).toBe('hit');
  });

  it('當前價略高於目標但 ≤ target*1.08 → near', () => {
    // 12800 * 1.08 = 13824
    expect(deriveSignal(13000, 12800)).toBe('near');
    expect(deriveSignal(13824, 12800)).toBe('near'); // 剛好 1.08x
  });

  it('當前價剛好略超過 1.08x → watching', () => {
    // 12800 * 1.08 = 13824，13825 已超過
    expect(deriveSignal(13825, 12800)).toBe('watching');
  });

  it('當前價遠高於 1.08x → watching', () => {
    expect(deriveSignal(20000, 12800)).toBe('watching');
  });

  it('target 為 0 的退化情境（不應發生但別 crash）', () => {
    // 0 <= 0 → hit，這雖然是垃圾資料，但函數要回傳合法 Signal
    expect(deriveSignal(0, 0)).toBe('hit');
  });
});

describe('SIGNAL_META — 結構不變性', () => {
  const SIGNALS: Signal[] = ['hit', 'near', 'watching'];

  it.each(SIGNALS)('每個 Signal 都有完整 meta: %s', (s) => {
    const m = SIGNAL_META[s];
    expect(m).toBeDefined();
    expect(typeof m.label).toBe('string');
    expect(m.label.length).toBeGreaterThan(0);
    expect(typeof m.color).toBe('string');
    expect(typeof m.bg).toBe('string');
    expect(typeof m.icon).toBe('string');
  });

  it('只有 watching 的 sub 是 null（其他要有副標）', () => {
    expect(SIGNAL_META.hit.sub).not.toBeNull();
    expect(SIGNAL_META.near.sub).not.toBeNull();
    expect(SIGNAL_META.watching.sub).toBeNull();
  });

  it('color 用 CSS var（避免 component 各自寫死顏色）', () => {
    SIGNALS.forEach(s => {
      expect(SIGNAL_META[s].color).toMatch(/var\(--/);
    });
  });

  it('icon name 都是 Icon component 認得的 name', () => {
    // 三個一定要在 ICON_NAMES 裡面
    expect(SIGNAL_META.hit.icon).toBe('target');
    expect(SIGNAL_META.near.icon).toBe('flame');
    expect(SIGNAL_META.watching.icon).toBe('eye');
  });
});
