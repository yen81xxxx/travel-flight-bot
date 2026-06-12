/**
 * useTheme — T1 主題切換核心行為
 *
 * 為什麼測這些（不只測「會 render」）：
 *   - resolveTheme 是「跟隨系統」語意的唯一真相 — system+prefersLight 才是 light，
 *     manual 模式必須無視系統偏好（拿錯 = 使用者手選深色卻被系統翻成淺色）
 *   - localStorage 持久化是使用者明確要求的行為（手動選擇要記住）
 *   - 壞值/無 matchMedia fallback 成 dark — LIFF 在舊 WebView 不能白屏
 */
import { renderHook, act } from '@testing-library/react';
import { useTheme, resolveTheme, THEME_STORAGE_KEY } from '../useTheme';

/** 可控的 matchMedia mock — matches + change listener */
function mockMatchMedia(initialMatches: boolean) {
  let listener: ((e: { matches: boolean }) => void) | null = null;
  const mql = {
    matches: initialMatches,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { listener = fn; },
    removeEventListener: () => { listener = null; }
  };
  window.matchMedia = jest.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    fireChange(matches: boolean) {
      mql.matches = matches;
      listener?.({ matches });
    }
  };
}

describe('resolveTheme（純函數）', () => {
  it('manual 模式無視系統偏好 — 手選 dark 在 light 系統下仍是 dark', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('system 模式跟隨 prefers-color-scheme', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
});

describe('useTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('預設 system + 系統偏好 dark → resolved=dark', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('system');
    expect(result.current.resolved).toBe('dark');
  });

  it('setMode 持久化到 localStorage（key=liff_theme）且立即生效', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('light'));
    expect(result.current.mode).toBe('light');
    expect(result.current.resolved).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('重新 mount 讀回存的選擇（持久化 round-trip）', () => {
    mockMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('light');
    expect(result.current.resolved).toBe('light');
  });

  it('存的壞值 → fallback 回 system（不會炸）', () => {
    mockMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-pink');
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('system');
  });

  it('system 模式下系統切換 → resolved 即時翻面；manual 模式不受影響', () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('dark');

    act(() => media.fireChange(true));
    expect(result.current.resolved).toBe('light');

    // 手選 dark 後，系統再怎麼變都不動
    act(() => result.current.setMode('dark'));
    act(() => media.fireChange(false));
    act(() => media.fireChange(true));
    expect(result.current.resolved).toBe('dark');
  });

  it('matchMedia 不存在（舊 WebView）→ 安全 fallback dark', () => {
    const original = window.matchMedia;
    // @ts-expect-error 模擬舊環境沒有 matchMedia
    delete window.matchMedia;
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('dark');
    window.matchMedia = original;
  });
});
