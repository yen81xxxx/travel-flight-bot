# 實施路線圖 - Phase 4.2 到 5

## 概述
本文檔詳細說明如何在剩餘的 30 次迭代中將應用優化至"可以賣的等級"。

---

## Phase 4.2: 集成優化 (迭代 21-30, 10 次)

### 任務 4.2.1: 圖片優化集成 (2 次)
```tsx
// 在 SearchFormV2 中添加圖片
import { OptimizedImage } from '@/components';

// 添加航班卡的圖片
<OptimizedImage
  config={{
    src: '/images/flights/default.jpg',
    alt: '航班',
    width: 600,
    height: 400,
    format: 'webp'
  }}
  lazy={true}
/>

// 為關鍵圖片預加載
preloadImages([
  '/images/hero.jpg',
  '/images/logo.png'
]);
```

**驗證**:
- [ ] LCP 改進 > 20%
- [ ] 圖片在 3 個頁面上優化
- [ ] WebP 格式被提供

### 任務 4.2.2: ARIA 標籤和語義 HTML (2 次)

```tsx
// SearchFormV2 改進
<main aria-label="航班搜尋表單">
  <section aria-label="搜尋參數">
    <FormField
      label="出發城市"
      id="origin"
      required
    >
      <input
        id="origin"
        aria-label="選擇出發台灣城市"
        aria-describedby="origin-hint"
        aria-invalid={!!errors.origin}
      />
    </FormField>
  </section>
</main>
```

**檢查清單**:
- [ ] 所有表單輸入都有標籤
- [ ] 所有按鈕都有 aria-label 或文字內容
- [ ] 使用語義 HTML 元素 (header, nav, main, section)
- [ ] ARIA 角色設置正確

### 任務 4.2.3: 鍵盤導航 (2 次)

```tsx
// 添加鍵盤事件處理
<form onKeyDown={(e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (currentStep === 1) handleNext();
    if (currentStep === 3) handleSubmit();
  }
  if (e.key === 'Escape') {
    handleCancel();
  }
}}>
  {/* form fields with proper tabIndex */}
</form>
```

**測試**:
- [ ] 使用 Tab 鍵遍歷所有元素
- [ ] Tab 順序邏輯清晰
- [ ] Enter 提交表單
- [ ] Escape 關閉模態框

### 任務 4.2.4: 色彩對比改進 (2 次)

使用 `ACCESSIBILITY_GUIDE.md` 中的標準：
- [ ] 所有文本 > 4.5:1 對比度
- [ ] 禁用元素 > 3:1 對比度
- [ ] 圖形對象 > 3:1 對比度

```tsx
// 改進受限狀態對比度
.btn:disabled {
  color: #6B7280;  // 從 #9CA3AF 改進
  background: #F3F4F6;
}
```

### 任務 4.2.5: 動畫無障礙 (2 次)

```css
/* 尊重 prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* 應用到組件 */
.stepContainer {
  animation: slideInUp 0.3s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .stepContainer {
    animation: none;
    opacity: 1;
  }
}
```

---

## Phase 4.3: 轉換優化 (迭代 31-40, 10 次)

### 任務 4.3.1: CTA 按鈕變體 (2 次)

A/B 測試 3 個 CTA 變體：
```tsx
// 變體 A: 當前
"查詢航班"

// 變體 B: 動作導向
"立即搜尋最便宜航班"

// 變體 C: 社會證明
"加入 10,000+ 使用者 查詢"
```

使用 `useSearchFormAB` 追蹤：
```tsx
const { variant, isVariantA, isVariantB, isVariantC, trackStepTransition } = useSearchFormAB();

<button onClick={() => {
  trackStepTransition(1, 2);
  handleNext();
}}>
  {isVariantA && "查詢航班"}
  {isVariantB && "立即搜尋最便宜航班"}
  {isVariantC && "加入 10,000+ 使用者 查詢"}
</button>
```

**指標追蹤**:
- [ ] Step 1→2 轉換率
- [ ] 按鈕點擊率
- [ ] 會話持續時間

### 任務 4.3.2: 表單驗證反饋 (2 次)

改進即時驗證：
```tsx
<FormField
  label="出發日期"
  id="departure"
  error={errors.departure}
  helperText={!errors.departure ? "選擇未來的日期" : undefined}
>
  <input
    id="departure"
    type="date"
    onBlur={() => validateField('departure')}
    aria-invalid={!!errors.departure}
    aria-describedby="departure-error"
  />
  {errors.departure && (
    <div id="departure-error" role="alert" className="error-message">
      {errors.departure}
    </div>
  )}
</FormField>
```

**改進**:
- [ ] 即時驗證反饋
- [ ] 清晰的錯誤消息
- [ ] 成功狀態指示器

### 任務 4.3.3: 移動 UX 優化 (2 次)

```tsx
// SearchFormV2 移動優化
@media (max-width: 768px) {
  .formSection {
    padding: 16px 12px;  // 更小的邊距
  }

  .btn {
    padding: 12px 16px;  // 更容易點擊
    min-height: 44px;   // 觸摸目標最小值
  }

  // 全寬按鈕用於移動
  .buttonGroup {
    flex-direction: column;
  }
}
```

### 任務 4.3.4: 顏色方案測試 (2 次)

A/B 測試顏色方案：
```tsx
// 變體 A: 當前 (藍色)
primary: '#0066FF'

// 變體 B: 綠色 (轉換友好)
primary: '#28A745'

// 變體 C: 橙色 (高緊迫性)
primary: '#FF8C00'
```

測試轉換率對顏色的敏感性。

### 任務 4.3.5: 進度指示改進 (2 次)

增強 Stepper 組件：
```tsx
<Stepper
  steps={[
    { label: '搜尋', icon: '🔍' },
    { label: '結果', icon: '📋' },
    { label: '確認', icon: '✓' }
  ]}
  currentStep={currentStep}
  onStepClick={(step) => {
    trackStepTransition(currentStep, step);
  }}
/>
```

---

## Phase 4.4: 分析和監控 (迭代 41-50, 10 次)

### 任務 4.4.1: 性能儀表板 (2 次)

創建管理員儀表板：
```bash
GET /api/admin/performance
- FCP/LCP 趨勢
- 頁面加載時間
- API 響應時間
- 核心 Web 生命週期指標
```

```tsx
// Admin 儀表板組件
<PerformanceDashboard>
  <MetricCard
    title="LCP"
    value="1.8s"
    target="2.5s"
    status="good"
  />
  <MetricCard
    title="FID"
    value="45ms"
    target="100ms"
    status="good"
  />
</PerformanceDashboard>
```

### 任務 4.4.2: 轉換漏斗分析 (2 次)

```bash
GET /api/admin/funnel-analytics
{
  step1_views: 10000,
  step1_to_step2: 8500 (85% 轉換)
  step2_to_step3: 6800 (80% 轉換)
  step3_conversions: 680 (10% 最終轉換)
}
```

追蹤按變體的轉換：
```tsx
const analytics = useFunnelAnalytics();
<table>
  {analytics.map(row => (
    <tr>
      <td>{row.variant}</td>
      <td>{row.step1_conversion}%</td>
      <td>{row.step2_conversion}%</td>
      <td>{row.final_conversion}%</td>
    </tr>
  ))}
</table>
```

### 任務 4.4.3: 性能警報 (2 次)

```typescript
// 設置性能警報
if (lcp > 2500) {
  alert('LCP 超過目標', 'action', {
    title: `LCP 降級: ${lcp}ms > 2500ms`,
    severity: 'warning'
  });
}

if (cls > 0.1) {
  alert('CLS 過高', 'action', {
    title: `CLS 降級: ${cls} > 0.1`,
    severity: 'error'
  });
}
```

### 任務 4.4.4: Google Analytics 集成 (2 次)

```bash
npm install @react-ga/core next-google-analytics
```

```tsx
// 在 layout.tsx 中
import { GA } from 'next-google-analytics';

<GA.Script src="https://www.googletagmanager.com/gtag/js?id=GA_ID" />

// 追蹤事件
gtag('event', 'step_transition', {
  step_from: 1,
  step_to: 2,
  variant: 'control'
});
```

### 任務 4.4.5: 用戶旅程映射 (2 次)

```typescript
interface UserJourney {
  userId: string;
  sessionId: string;
  pages: Array<{
    page: string;
    duration: number;
    timestamp: number;
  }>;
  events: Array<{
    event: string;
    data: Record<string, any>;
    timestamp: number;
  }>;
  conversion: boolean;
}

// 視覺化旅程
<JourneyMap journeys={userJourneys} />
```

---

## 最終檢查清單

### 性能指標
- [ ] FCP < 1.8s
- [ ] LCP < 2.5s
- [ ] FID < 100ms
- [ ] CLS < 0.1
- [ ] TBT < 200ms
- [ ] TTI < 3.8s

### 無障礙
- [ ] WCAG 2.1 AA 合規
- [ ] 所有互動元素可鍵盤訪問
- [ ] 所有圖像有替代文本
- [ ] 色彩對比 > 4.5:1
- [ ] 屏幕閱讀器測試通過

### 轉換優化
- [ ] Step 1→2 > 85%
- [ ] Step 2→3 > 80%
- [ ] 最終轉換 > 10%
- [ ] 表單放棄 < 20%

### 代碼質量
- [ ] TypeScript: 零錯誤
- [ ] ESLint: 無嚴重警告
- [ ] 單元測試覆蓋 > 80%
- [ ] 性能測試通過

---

## 預計時間表

| 階段 | 迭代 | 預計時間 | 狀態 |
|------|------|---------|------|
| Phase 1-2 | 1-10 | 完成 | ✅ |
| Phase 3 | 11-20 | 完成 | ✅ |
| Phase 4.1 | 21-25 | 進行中 | 🔄 |
| Phase 4.2 | 26-35 | 待做 | ⏳ |
| Phase 4.3 | 36-45 | 待做 | ⏳ |
| Phase 5 | 46-50 | 待做 | ⏳ |

---

## 成功指標

達到"可以賣的等級"的定義：

✅ **性能**: Lighthouse 分數 > 95  
✅ **無障礙**: WCAG 2.1 AA 合規  
✅ **轉換**: 超過 10% 預訂轉換率  
✅ **可靠性**: 99.9% 正常運行時間  
✅ **用戶滿意度**: NPS > 50  

---

*最後更新: 2026-05-14*
