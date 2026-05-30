'use client';

import { useEffect, useState } from 'react';

interface Props {
  active: 'search' | 'subscriptions' | 'settings';
  liffId?: string;
}

/**
 * LIFF 三個頁面共用的頂部 tab 列。
 * 從 URL 或 sessionStorage 讀 ctx (群組 ID) 並 preserve 到所有 tab 連結。
 */
export default function TabNav({ active, liffId }: Props) {
  const [ctx, setCtx] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlCtx = new URLSearchParams(window.location.search).get('ctx');
    if (urlCtx && (urlCtx.startsWith('C') || urlCtx.startsWith('R'))) {
      setCtx(urlCtx);
      sessionStorage.setItem('liff_ctx', urlCtx);
      // 同時記到 localStorage 的 known group ctxs（持久化），讓「我的訂閱」之後從任何入口都能撈到群組訂閱
      try {
        const KEY = 'liff_known_group_ctxs';
        const raw = window.localStorage.getItem(KEY);
        const arr: string[] = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr) && !arr.includes(urlCtx)) {
          window.localStorage.setItem(KEY, JSON.stringify([...arr, urlCtx]));
        }
      } catch {
        // 忽略 storage 錯誤
      }
    } else {
      const saved = sessionStorage.getItem('liff_ctx');
      if (saved && (saved.startsWith('C') || saved.startsWith('R'))) {
        setCtx(saved);
      }
    }
  }, []);

  const ctxQS = ctx ? `?ctx=${encodeURIComponent(ctx)}` : '';

  // 查航班頁要用 liff.line.me URL 觸發 LIFF auth；訂閱、設定走直接路徑
  const searchUrl = liffId
    ? `https://liff.line.me/${liffId}${ctxQS}`
    : `/liff/search${ctxQS}`;
  const subsUrl = `/liff/subscriptions${ctxQS}`;
  // 設定頁：有 ctx 直接去 settings (跳過 OAuth)、沒有就走 subscriptions ?goto=settings (走白名單)
  const settingsUrl = ctx ? `/liff/settings${ctxQS}` : `/liff/subscriptions?goto=settings`;

  return (
    <nav className="tabnav">
      <a href={searchUrl} className={`tab ${active === 'search' ? 'active' : ''}`} data-preload-search>
        🔍 查航班
      </a>
      <a href={subsUrl} className={`tab ${active === 'subscriptions' ? 'active' : ''}`} data-preload-subscriptions>
        📋 我的訂閱
      </a>
      <a href={settingsUrl} className={`tab ${active === 'settings' ? 'active' : ''}`} data-preload-settings>
        ⚙️ 設定
      </a>
      <style jsx>{`
        .tabnav {
          display: flex;
          gap: 4px;
          padding: 8px 12px 10px;
          background: rgba(0, 0, 0, 0.78);
          backdrop-filter: saturate(180%) blur(20px);
          -webkit-backdrop-filter: saturate(180%) blur(20px);
          border-bottom: 0.5px solid rgba(84, 84, 88, 0.65);
          position: sticky;
          top: 0;
          z-index: 100;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'PingFang TC', sans-serif;
        }
        .tab {
          flex: 1;
          padding: 8px 4px;
          text-align: center;
          font-size: 13px;
          font-weight: 500;
          color: rgba(235, 235, 245, 0.6);
          border-radius: 10px;
          text-decoration: none;
          background: transparent;
          letter-spacing: -0.08px;
          transition: all 0.2s ease;
          white-space: nowrap;
          -webkit-tap-highlight-color: transparent;
        }
        .tab:hover {
          color: #ffffff;
        }
        .tab.active {
          background: rgba(120, 120, 128, 0.32);
          color: #ffffff;
          font-weight: 600;
        }
      `}</style>
    </nav>
  );
}
