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
          gap: 6px;
          padding: 8px;
          background: #0a0e1a;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          position: sticky;
          top: 0;
          z-index: 100;
          font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', sans-serif;
        }
        .tab {
          flex: 1;
          padding: 10px 6px;
          text-align: center;
          font-size: 13px;
          font-weight: 600;
          color: #7e88a8;
          border-radius: 8px;
          text-decoration: none;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid transparent;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .tab:hover {
          background: rgba(255, 255, 255, 0.04);
          color: #cdd5f0;
        }
        .tab.active {
          background: rgba(255, 122, 69, 0.15);
          color: #ff7a45;
          border-color: rgba(255, 122, 69, 0.4);
        }
      `}</style>
    </nav>
  );
}
