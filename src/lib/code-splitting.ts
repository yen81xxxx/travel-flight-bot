/**
 * 代碼分割和動態導入工具
 * 用於優化首屏載入時間
 */

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

/**
 * 動態導入組件（帶加載狀態）
 */
export function createLazyComponent<P extends Record<string, any>>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  LoadingComponent?: () => JSX.Element | null
) {
  return dynamic(importFn, {
    loading: LoadingComponent,
    ssr: true
  });
}

/**
 * 路由級代碼分割
 * 用於 LIFF 頁面的延遲加載
 */
export const lazyRoutes = {
  SearchForm: () => import('@/app/liff/search/SearchFormV2'),
  SettingsView: () => import('@/app/liff/settings/SettingsViewV2'),
  SubscriptionsView: () => import('@/app/liff/subscriptions/SubscriptionsViewV2')
};

/**
 * 預加載模塊
 */
export async function preloadModule<T>(
  importFn: () => Promise<T>
): Promise<void> {
  try {
    await importFn();
  } catch (error) {
    console.warn('[preloadModule] Failed to preload:', error);
  }
}

/**
 * 智能預加載（基於用戶意圖）
 */
export function setupSmartPreloading(): void {
  if (typeof window === 'undefined') return;

  // 當用戶將滑鼠懸停在導航連結上時，預加載對應模塊
  // 這利用了 "hovering over a link" 是"將點擊該連結" 的強訊號的事實
  document.addEventListener('mouseenter', (e) => {
    const target = e.target as HTMLElement;

    if (target.closest('[data-preload-search]')) {
      preloadModule(() => import('@/app/liff/search/SearchFormV2'));
    }

    if (target.closest('[data-preload-subscriptions]')) {
      preloadModule(() => import('@/app/liff/subscriptions/SubscriptionsViewV2'));
    }

    if (target.closest('[data-preload-settings]')) {
      preloadModule(() => import('@/app/liff/settings/SettingsViewV2'));
    }
  }, true);
}

/**
 * 性能報告
 */
export interface PerformanceReport {
  fcp: number; // First Contentful Paint
  lcp: number; // Largest Contentful Paint
  fid: number; // First Input Delay
  cls: number; // Cumulative Layout Shift
  tbt: number; // Total Blocking Time
  tti: number; // Time to Interactive
}

/**
 * 收集性能指標
 */
export function collectPerformanceMetrics(): PerformanceReport | null {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
    return null;
  }

  try {
    const paintEntries = performance.getEntriesByType('paint');
    const navigationTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

    const fcp = paintEntries.find(entry => entry.name === 'first-contentful-paint')?.startTime || 0;
    const lcp = getLargestContentfulPaint();
    const fid = getFirstInputDelay();
    const cls = getCumulativeLayoutShift();
    const tbt = getTotalBlockingTime();
    const tti = navigationTiming?.loadEventEnd || 0;

    return {
      fcp,
      lcp,
      fid,
      cls,
      tbt,
      tti
    };
  } catch (error) {
    console.warn('[collectPerformanceMetrics] Failed to collect metrics:', error);
    return null;
  }
}

/**
 * 獲取最大內容繪製時間
 */
function getLargestContentfulPaint(): number {
  if (!('PerformanceObserver' in window)) return 0;

  let lcp = 0;
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1] as any;
      lcp = lastEntry?.renderTime || lastEntry?.loadTime || 0;
    });

    observer.observe({ entryTypes: ['largest-contentful-paint'] });

    // 清理
    setTimeout(() => observer.disconnect(), 5000);
  } catch (error) {
    console.warn('[getLargestContentfulPaint] Failed:', error);
  }

  return lcp;
}

/**
 * 獲取首次輸入延遲
 */
function getFirstInputDelay(): number {
  if (!('PerformanceObserver' in window)) return 0;

  let fid = 0;
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length > 0) {
        const firstInput = entries[0] as PerformanceEventTiming;
        fid = firstInput.processingStart - firstInput.startTime;
      }
    });

    observer.observe({ entryTypes: ['first-input'] });

    // 清理
    setTimeout(() => observer.disconnect(), 5000);
  } catch (error) {
    console.warn('[getFirstInputDelay] Failed:', error);
  }

  return fid;
}

/**
 * 獲取累積佈局偏移
 */
function getCumulativeLayoutShift(): number {
  if (!('PerformanceObserver' in window)) return 0;

  let cls = 0;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as any).hadRecentInput) {
          cls += (entry as any).value;
        }
      }
    });

    observer.observe({ entryTypes: ['layout-shift'] });

    // 清理
    setTimeout(() => observer.disconnect(), 5000);
  } catch (error) {
    console.warn('[getCumulativeLayoutShift] Failed:', error);
  }

  return cls;
}

/**
 * 獲取總阻塞時間
 */
function getTotalBlockingTime(): number {
  if (!('PerformanceObserver' in window)) return 0;

  let tbt = 0;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        tbt += (entry as any).duration - 50;
      }
    });

    observer.observe({ entryTypes: ['longtask'] });

    // 清理
    setTimeout(() => observer.disconnect(), 5000);
  } catch (error) {
    console.warn('[getTotalBlockingTime] Failed:', error);
  }

  return tbt;
}

/**
 * 報告性能指標到分析服務
 */
export async function reportMetrics(metrics: PerformanceReport): Promise<void> {
  try {
    await fetch('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics)
    });
  } catch (error) {
    console.warn('[reportMetrics] Failed to report:', error);
  }
}

/**
 * 監控性能並報告
 */
export function monitorPerformance(): void {
  if (typeof window === 'undefined') return;

  // 在頁面加載完成後收集指標
  if (document.readyState === 'complete') {
    const metrics = collectPerformanceMetrics();
    if (metrics) {
      reportMetrics(metrics);
    }
  } else {
    window.addEventListener('load', () => {
      const metrics = collectPerformanceMetrics();
      if (metrics) {
        reportMetrics(metrics);
      }
    });
  }
}
