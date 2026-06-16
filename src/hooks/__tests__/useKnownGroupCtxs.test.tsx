/**
 * useKnownGroupCtxs — add / prune（#7 幽靈群組清除）
 *
 * 為什麼測 prune：群組所有訂閱刪光後要把 ctx 從 localStorage 清掉，
 * 否則每次開 LIFF 都白白 fetch 一個空群組、卡片殘留感。
 * 清掉後從該群組再開（URL 帶 ?ctx=）會自動 re-add，所以安全。
 */
import { renderHook, act } from '@testing-library/react';
import { useKnownGroupCtxs } from '../useKnownGroupCtxs';

const KEY = 'liff_known_group_ctxs';

describe('useKnownGroupCtxs', () => {
  beforeEach(() => window.localStorage.clear());

  it('add：去重 + 寫回 localStorage；非法 ctx 忽略', () => {
    const { result } = renderHook(() => useKnownGroupCtxs());
    act(() => result.current.add('Cabc'));
    act(() => result.current.add('Cabc'));        // 重複
    act(() => result.current.add('Uxxx'));        // 非群組 → 忽略
    act(() => result.current.add(null));
    expect(result.current.ctxs).toEqual(['Cabc']);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual(['Cabc']);
  });

  it('prune：移除指定 ctx 並寫回；不存在的 ctx 不動', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['Cabc', 'Rdef']));
    const { result } = renderHook(() => useKnownGroupCtxs());
    act(() => result.current.prune('Cabc'));
    expect(result.current.ctxs).toEqual(['Rdef']);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual(['Rdef']);
    // 不存在的 → no-op
    act(() => result.current.prune('Cnope'));
    expect(result.current.ctxs).toEqual(['Rdef']);
  });

  it('prune 後可被 add 重新加回（從群組再開的情境）', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['Cabc']));
    const { result } = renderHook(() => useKnownGroupCtxs());
    act(() => result.current.prune('Cabc'));
    expect(result.current.ctxs).toEqual([]);
    act(() => result.current.add('Cabc'));
    expect(result.current.ctxs).toEqual(['Cabc']);
  });
});
