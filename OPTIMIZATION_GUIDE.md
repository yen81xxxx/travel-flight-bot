# 性能優化指南

## 概述

本專案已集成完整的性能優化基礎設施，包括：

1. **代碼分割** - 自動懶加載頁面和模塊
2. **性能監控** - 收集 Core Web Vitals (FCP, LCP, FID, CLS, TBT, TTI)
3. **圖片優化** - 響應式圖片、懶加載、格式檢測
4. **智能預加載** - 基於用戶交互預測性加載

---

## 1. 自動性能監控

### 工作原理

`PerformanceMonitor` 組件在根布局中自動初始化：

```tsx
// src/app/layout.tsx
import PerformanceMonitor from './PerformanceMonitor';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <PerformanceMonitor /> {/* 自動監控性能 */}
        {children}
      </body>
    </html>
  );
}
```

**監控指標：**

| 指標 | 說明 | 目標 |
|------|------|------|
| FCP | First Contentful Paint (首次內容繪製) | < 1.8s |
| LCP | Largest Contentful Paint (最大內容繪製) | < 2.5s |
| FID | First Input Delay (首次輸入延遲) | < 100ms |
| CLS | Cumulative Layout Shift (累積佈局偏移) | < 0.1 |
| TBT | Total Blocking Time (總阻塞時間) | < 200ms |
| TTI | Time to Interactive (可交互時間) | < 3.8s |

**數據收集**

指標自動發送到 `POST /api/metrics` 端點，可在生產環境中集成到：

- Google Analytics
- DataDog
- New Relic
- CloudWatch
- 自建數據倉庫

---

## 2. 智能預加載

### 工作原理

當用戶將滑鼠懸停在導航連結上時，自動預加載對應的頁面模塊。

```tsx
// src/app/liff/TabNav.tsx
<a href="/liff/subscriptions" data-preload-subscriptions>
  📋 我的訂閱
</a>
```

被監控的屬性：

- `data-preload-search` - 預加載搜尋頁面
- `data-preload-subscriptions` - 預加載訂閱頁面
- `data-preload-settings` - 預加載設定頁面

預加載在 `PerformanceMonitor` 中自動啟動。

---

## 3. 圖片優化

### 基本用法

使用 `OptimizedImage` 組件自動處理圖片優化：

```tsx
import { OptimizedImage } from '@/components';

export default function MyPage() {
  return (
    <OptimizedImage
      config={{
        src: '/images/flight.jpg',
        alt: '航班查詢',
        width: 800,
        height: 600,
        quality: 85,
        format: 'webp'
      }}
      lazy={true}  // 啟用懶加載
    />
  );
}
```

### Hook 用法

如果需要手動控制，使用 `useOptimizedImage` hook：

```tsx
import { useOptimizedImage } from '@/hooks';

export default function SearchPage() {
  const hero = useOptimizedImage({
    src: '/images/hero.jpg',
    alt: '英雄圖',
    width: 1200,
    height: 400
  });

  return (
    <img
      src={hero.src}
      srcSet={hero.srcSet}
      sizes={hero.sizes}
      alt={hero.alt}
    />
  );
}
```

### 功能

- **響應式 srcset** - 自動為不同螢幕尺寸生成圖片變種
- **格式自動選擇** - 檢測瀏覽器支持，優先使用 WebP/AVIF
- **懶加載** - 圖片進入視口時才加載
- **CLS 預防** - 自動計算縱橫比，防止佈局偏移
- **品質優化** - 可配置 75-95% 的品質設置

---

## 4. 動態導入

### 自動代碼分割

頁面在 `lazyRoutes` 中已配置自動分割：

```ts
// src/lib/code-splitting.ts
export const lazyRoutes = {
  SearchForm: () => import('@/app/liff/search/SearchFormV2'),
  SettingsView: () => import('@/app/liff/settings/SettingsViewV2'),
  SubscriptionsView: () => import('@/app/liff/subscriptions/SubscriptionsViewV2')
};
```

### 自定義動態導入

```tsx
import { createLazyComponent } from '@/lib/code-splitting';
import { Spinner } from '@/components';

const MyComponent = createLazyComponent(
  () => import('./MyComponent'),
  () => <Spinner /> // 加載中顯示
);

export default MyComponent;
```

---

## 5. 資源提示

根布局會自動添加以下資源提示：

```tsx
// src/app/ResourceHints.tsx
<link rel="preconnect" href="https://api.line.me" />
<link rel="dns-prefetch" href="https://liff.line.me" />
<link rel="prefetch" href="/api/subscriptions" as="fetch" />
```

這加速了第三方連接和 API 調用。

---

## 6. 實施檢查清單

### ✓ 已完成

- [x] 性能監控基礎設施（FCP, LCP, FID, CLS, TBT, TTI）
- [x] 智能預加載系統
- [x] 圖片優化工具和組件
- [x] 代碼分割配置
- [x] 資源提示配置
- [x] 性能 API 端點

### 待實施

- [ ] 集成圖片優化到實際頁面（SearchForm, Settings, Subscriptions）
- [ ] A/B 測試框架應用（轉換率測試）
- [ ] 性能監控儀表板
- [ ] 性能警報和趨勢分析
- [ ] PWA 支持（離線功能）
- [ ] 字體優化（預加載、字體選擇）

---

## 7. 測試性能

### 本地測試

```bash
# 生成優化的生產構建
npm run build

# 啟動生產服務器
npm start

# 使用 Chrome DevTools 檢查性能
# 1. 打開 DevTools (F12)
# 2. 進入 Performance 標籤
# 3. 點擊錄製，加載頁面
# 4. 檢查指標
```

### Google Lighthouse

```bash
# 安裝 Lighthouse CLI
npm install -g @lhci/cli@latest

# 運行 Lighthouse 審計
lhci autorun
```

### 監控指標

在瀏覽器控制台檢查發送的指標：

```javascript
// 監聽性能數據
fetch('/api/metrics', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fcp: 1200,
    lcp: 1800,
    fid: 45,
    cls: 0.05,
    tbt: 150,
    tti: 3200
  })
})
```

---

## 8. 配置參考

### 環境變數

```env
# .env.local
NEXT_PUBLIC_LIFF_ID=your-liff-id
NEXT_PUBLIC_API_ENDPOINT=https://api.example.com

# 性能配置
NEXT_PUBLIC_ENABLE_PERFORMANCE_MONITORING=true
NEXT_PUBLIC_ENABLE_IMAGE_OPTIMIZATION=true
```

### Next.js 配置

```js
// next.config.js
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb'
    }
  },
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [360, 640, 768, 1024, 1280]
  }
};
```

---

## 9. 最佳實踐

### 圖片

- 使用 `OptimizedImage` 組件
- 為關鍵圖片設置 `lazy={false}`
- 為視口外的圖片使用懶加載

### 代碼分割

- 利用 `lazyRoutes` 進行頁面分割
- 為大型模塊使用 `createLazyComponent`
- 避免過度分割（過多 HTTP 請求）

### 監控

- 定期檢查性能指標
- 設置警報閾值
- 追蹤指標趨勢

### 緩存

```tsx
// 充分利用 HTTP 緩存頭
export const revalidate = 3600; // 1 小時重新驗證

export async function generateStaticParams() {
  return [
    { slug: 'search' },
    { slug: 'settings' },
    { slug: 'subscriptions' }
  ];
}
```

---

## 10. 故障排除

### 性能指標未被收集

1. 檢查 `PerformanceMonitor` 在根布局中
2. 檢查瀏覽器控制台是否有錯誤
3. 確認 `/api/metrics` 端點可訪問

### 圖片未被優化

1. 使用 `OptimizedImage` 組件而不是原生 `<img>`
2. 檢查圖片路徑是否正確
3. 在 DevTools Network 標籤中檢查 srcset 響應

### 預加載未觸發

1. 確保導航元素有 `data-preload-*` 屬性
2. 檢查 `setupSmartPreloading()` 是否在 `PerformanceMonitor` 中被調用
3. 嘗試在控制台中手動調用

---

## 11. 相關資源

- [Next.js 性能優化](https://nextjs.org/learn/seo/introduction-to-web-performance)
- [Web Vitals 指南](https://web.dev/vitals/)
- [圖片優化最佳實踐](https://web.dev/image-optimization/)
- [代碼分割指南](https://nextjs.org/docs/advanced-features/dynamic-import)
- [性能監控工具](https://web.dev/performance/)

---

*最後更新: 2026-05-14*
