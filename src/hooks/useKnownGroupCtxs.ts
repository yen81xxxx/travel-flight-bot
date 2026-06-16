/**
 * useKnownGroupCtxs — 用 localStorage 記住「使用者進過的所有群組 ctx」。
 * 解決問題：在群組內訂閱後，從 1:1 或主選單打開「我的訂閱」會看不到群組訂閱
 * （因為當下 URL 沒帶 ctx）。記住所有已知 group ctx 後，訂閱頁就能 fetch
 * 個人 + 所有已知群組訂閱合併顯示。
 */
import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'liff_known_group_ctxs';

function isValidGroupCtx(s: string | null | undefined): boolean {
  return !!s && (s.startsWith('C') || s.startsWith('R'));
}

function readFromStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidGroupCtx);
  } catch {
    return [];
  }
}

function writeToStorage(ctxs: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ctxs));
  } catch {
    // 忽略 quota 等錯誤
  }
}

export function useKnownGroupCtxs() {
  const [ctxs, setCtxs] = useState<string[]>([]);

  // 初始化讀 localStorage
  useEffect(() => {
    setCtxs(readFromStorage());
  }, []);

  // 加入一個新的 group ctx（自動去重 + 寫回 storage）
  const add = useCallback((ctx: string | null | undefined) => {
    if (!isValidGroupCtx(ctx)) return;
    setCtxs(prev => {
      if (prev.includes(ctx!)) return prev;
      const next = [...prev, ctx!];
      writeToStorage(next);
      return next;
    });
  }, []);

  // 移除一個已知 group ctx（該群組已無任何 active 訂閱時清掉，避免幽靈群組
  // 一直被 fetch + 卡片殘留）。之後使用者從該群組再開 LIFF（URL 帶 ?ctx=）會自動 re-add。
  const prune = useCallback((ctx: string) => {
    setCtxs(prev => {
      if (!prev.includes(ctx)) return prev;
      const next = prev.filter(c => c !== ctx);
      writeToStorage(next);
      return next;
    });
  }, []);

  return { ctxs, add, prune };
}
