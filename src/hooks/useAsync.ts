/**
 * useAsync Hook - 通用的非同步操作管理
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export interface UseAsyncReturn<T> extends AsyncState<T> {
  refetch: () => Promise<void>;
  reset: () => void;
}

/**
 * 通用的非同步操作 Hook
 */
export function useAsync<T>(
  asyncFn: () => Promise<T>,
  immediate = true,
  dependencies: unknown[] = []
): UseAsyncReturn<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: immediate,
    error: null
  });

  const isMountedRef = useRef(true);

  // 執行非同步操作
  const refetch = useCallback(async () => {
    setState({ data: null, loading: true, error: null });

    try {
      const result = await asyncFn();
      if (isMountedRef.current) {
        setState({ data: result, loading: false, error: null });
      }
    } catch (err) {
      if (isMountedRef.current) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ data: null, loading: false, error });
      }
    }
  }, [asyncFn]);

  // 組件卸載時清理
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 初始化和依賴變化時執行
  useEffect(() => {
    if (immediate) {
      refetch();
    }
  }, dependencies);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, refetch, reset };
}

/**
 * 簡化版：直接傳入函數和自動執行
 */
export function useFetch<T>(
  url: string,
  options?: RequestInit
): UseAsyncReturn<T> {
  return useAsync(
    () => fetch(url, options).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<T>;
    }),
    true,
    [url, JSON.stringify(options || {})]
  );
}
