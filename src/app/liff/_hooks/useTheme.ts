/**
 * useTheme — LIFF 主題切換（深色 / 淺色 / 跟隨系統）
 *
 * 機制（THEMING_SPEC）：dark 是 tokens.css 的 :root 基底；light 是
 * [data-theme="light"] 覆寫塊。本 hook 只負責算出「現在該掛哪個
 * data-theme」，由 WatchlistView 掛在 .wl-wrap 根元素上。
 *
 * - mode：使用者的選擇（'dark' | 'light' | 'system'），存 localStorage
 * - resolved：實際生效主題（system 模式下跟 prefers-color-scheme 連動）
 * - 預設 'system'；matchMedia 監聽系統切換即時翻面
 * - SSR / matchMedia 不存在（舊 jsdom）→ 安全 fallback 成 dark
 */
import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';

export const THEME_STORAGE_KEY = 'liff_theme';

function readStoredMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  } catch {
    /* localStorage 不可用（私密模式等）→ 用預設 */
  }
  return 'system';
}

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function resolveTheme(mode: ThemeMode, prefersLight: boolean): 'dark' | 'light' {
  if (mode === 'system') return prefersLight ? 'light' : 'dark';
  return mode;
}

interface UseThemeResult {
  /** 使用者的選擇（設定面板顯示用） */
  mode: ThemeMode;
  /** 實際生效主題（掛到 data-theme） */
  resolved: 'dark' | 'light';
  setMode: (mode: ThemeMode) => void;
}

export function useTheme(): UseThemeResult {
  // lazy init — 第一個 render 就讀到存的值，避免 dark→light 閃一下
  const [mode, setModeState] = useState<ThemeMode>(() =>
    typeof window === 'undefined' ? 'system' : readStoredMode()
  );
  const [prefersLight, setPrefersLight] = useState<boolean>(() => systemPrefersLight());

  // system 模式下監聽 prefers-color-scheme 變化
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => setPrefersLight(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* 存不進去就只活在本次 session — 行為仍正確 */
    }
  }, []);

  return { mode, resolved: resolveTheme(mode, prefersLight), setMode };
}
