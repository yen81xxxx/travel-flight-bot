/**
 * useLiff Hook - LIFF 初始化和狀態管理
 */

import { useState, useEffect, useCallback } from 'react';

export interface LiffUser {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

export interface UseLiffReturn {
  liffReady: boolean;
  isInLine: boolean;
  isLoggedIn: boolean;
  user: LiffUser | null;
  error: string | null;
  login: () => Promise<void>;
}

/**
 * LIFF 初始化和登入管理
 */
export function useLiff(liffId?: string): UseLiffReturn {
  const [liffReady, setLiffReady] = useState(false);
  const [isInLine, setIsInLine] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<LiffUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 初始化 LIFF
  useEffect(() => {
    if (!liffId) {
      setLiffReady(true);
      return;
    }

    (async () => {
      try {
        const { default: liff } = await import('@line/liff');
        await liff.init({ liffId });

        setIsInLine(liff.isInClient());
        setLiffReady(true);

        // 檢查登入狀態
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();
          setIsLoggedIn(true);
          setUser({
            userId: profile.userId,
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'LIFF initialization failed';
        console.error('[useLiff] Initialization error:', err);
        setError(message);
        setLiffReady(true);
      }
    })();
  }, [liffId]);

  // 登入
  const login = useCallback(async () => {
    try {
      const { default: liff } = await import('@line/liff');
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      console.error('[useLiff] Login error:', err);
      setError(message);
    }
  }, []);

  return {
    liffReady,
    isInLine,
    isLoggedIn,
    user,
    error,
    login
  };
}
