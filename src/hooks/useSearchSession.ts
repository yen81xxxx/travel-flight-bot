/**
 * useSearchSession Hook - 跨會話保存搜尋狀態
 * 允許用戶暫停並稍後繼續搜尋
 */

import { useEffect, useCallback } from 'react';
import { useSessionStorage } from './useSessionStorage';

export interface SearchSessionState {
  step: number;
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  isOneWay: boolean;  // ☑ 單程訂閱（不追蹤回程）
  searchResult?: any;
  customMaxPrice: string;
  subLabel: string;
  subscribeAs: 'self' | 'group';
  timestamp: number;
}

const DEFAULT_STATE: SearchSessionState = {
  step: 0,
  origin: 'TPE',
  destination: 'HND',
  outboundDate: '',
  returnDate: '',
  isOneWay: false,
  customMaxPrice: '',
  subLabel: '',
  subscribeAs: 'self',
  timestamp: Date.now()
};

/**
 * 搜尋會話管理 Hook
 * 自動保存和恢復搜尋狀態
 */
export function useSearchSession() {
  const [sessionState, setSessionState] = useSessionStorage<SearchSessionState>(
    'search_session',
    DEFAULT_STATE
  );

  // 更新會話狀態
  const updateSession = useCallback((updates: Partial<SearchSessionState>) => {
    setSessionState(prev => ({
      ...prev,
      ...updates,
      timestamp: Date.now()
    }));
  }, [setSessionState]);

  // 前進到下一步
  const nextStep = useCallback(() => {
    updateSession({ step: Math.min(sessionState.step + 1, 2) });
  }, [sessionState.step, updateSession]);

  // 回到上一步
  const previousStep = useCallback(() => {
    updateSession({ step: Math.max(sessionState.step - 1, 0) });
  }, [sessionState.step, updateSession]);

  // 跳轉到特定步驟
  const goToStep = useCallback((step: number) => {
    if (step >= 0 && step <= 2) {
      updateSession({ step });
    }
  }, [updateSession]);

  // 清除會話
  const clearSession = useCallback(() => {
    setSessionState(DEFAULT_STATE);
  }, [setSessionState]);

  // 檢查會話是否過期（超過 1 小時）
  const isSessionExpired = useCallback(() => {
    const oneHourMs = 60 * 60 * 1000;
    return Date.now() - sessionState.timestamp > oneHourMs;
  }, [sessionState.timestamp]);

  // 如果會話過期，自動清除
  useEffect(() => {
    if (isSessionExpired()) {
      clearSession();
    }
  }, [isSessionExpired, clearSession]);

  return {
    state: sessionState,
    updateSession,
    nextStep,
    previousStep,
    goToStep,
    clearSession,
    isSessionExpired
  };
}
