/**
 * useSessionStorage Hook - 安全的 sessionStorage 管理
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * 安全的 sessionStorage Hook（避免 SSR 問題）
 */
export function useSessionStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  // 初始化時從 sessionStorage 讀取
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const item = window.sessionStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item) as T);
      }
    } catch (err) {
      console.error(`[useSessionStorage] Failed to read key "${key}":`, err);
    }
  }, [key]);

  // 更新值並同步到 sessionStorage
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);

      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (err) {
      console.error(`[useSessionStorage] Failed to write key "${key}":`, err);
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
}

/**
 * 簡化版：不需要反序列化
 */
export function useSessionStorageString(key: string, initialValue: string = ''): [string, (value: string) => void] {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(key);
    if (stored) setValue(stored);
  }, [key]);

  const setStringValue = useCallback((newValue: string) => {
    setValue(newValue);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(key, newValue);
    }
  }, [key]);

  return [value, setStringValue];
}

/**
 * 清除 sessionStorage 中的值
 */
export function useClearSessionStorage(key: string): () => void {
  return useCallback(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.removeItem(key);
  }, [key]);
}
