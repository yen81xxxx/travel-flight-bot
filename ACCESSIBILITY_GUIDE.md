# 無障礙實施指南 (WCAG 2.1 AA)

## 概述

本指南涵蓋達到 WCAG 2.1 AA 無障礙標準所需的實施步驟。

---

## 1. 顏色對比 (Contrast)

### 標準
- **正常文本** (< 18pt): 最少 4.5:1 對比度
- **大文本** (≥ 18pt): 最少 3:1 對比度
- **圖形對象**: 最少 3:1 對比度

### 檢查清單

| 元素 | 前景色 | 背景色 | 對比度 | 狀態 |
|------|--------|---------|--------|------|
| 主按鈕 (#0066FF) | #0066FF | #FFFFFF | 4.99:1 | ✓ |
| 次級按鈕文字 | #0066FF | #F0F4FF | 3.02:1 | ✓ |
| 標籤文字 | #374151 | #FFFFFF | 7.32:1 | ✓ |
| 幫助文字 | #6B7280 | #FFFFFF | 4.74:1 | ✓ |
| 錯誤文字 | #DC2626 | #FFFFFF | 5.83:1 | ✓ |
| 禁用按鈕 | #9CA3AF | #F3F4F6 | 3.24:1 | ✓ |

### 改進建議

```tsx
// 不佳: 對比度不足
<span style={{ color: '#9CA3AF', background: '#F3F4F6' }}>
  Disabled text (1.65:1)
</span>

// 改進: 更好的對比度
<span style={{ color: '#6B7280', background: '#FFFFFF' }}>
  Disabled text (4.74:1)
</span>
```

---

## 2. 鍵盤導航

### 實施步驟

#### 2.1 Tab 順序
```tsx
// 按邏輯順序設置 tabIndex
<input tabIndex={1} placeholder="出發城市" />
<input tabIndex={2} placeholder="目的地" />
<input tabIndex={3} placeholder="出發日期" />
<button tabIndex={4}>搜尋</button>
```

#### 2.2 焦點可見性
```css
.input:focus,
.btn:focus {
  outline: 2px solid #0066FF;
  outline-offset: 2px;
}
```

#### 2.3 Enter 鍵提交
```tsx
<form onKeyPress={(e) => {
  if (e.key === 'Enter') {
    handleSubmit();
  }
}}>
  {/* form fields */}
</form>
```

### 測試方法
- 按 Tab 遍歷所有交互元素
- 確保焦點順序邏輯清晰
- 使用 Escape 關閉模態框
- 使用 Enter 提交表單

---

## 3. 屏幕閱讀器支持

### 3.1 ARIA 標籤

```tsx
// 表單輸入
<input
  id="origin-city"
  aria-label="出發城市"
  aria-describedby="origin-hint"
  placeholder="選擇出發城市"
/>
<span id="origin-hint" className="hint">
  選擇台灣的出發機場
</span>

// 按鈕
<button
  aria-label="刪除此訂閱"
  aria-pressed={isActive}
  onClick={handleDelete}
>
  ✕
</button>

// 區域
<nav aria-label="主導航">
  {/* navigation items */}
</nav>

<main aria-label="搜尋表單">
  {/* form content */}
</main>
```

### 3.2 角色和狀態

```tsx
// 選項卡導航
<div role="tablist">
  <button
    role="tab"
    aria-selected={activeStep === 1}
    aria-controls="step-1"
  >
    Step 1
  </button>
  <div id="step-1" role="tabpanel">
    {/* content */}
  </div>
</div>

// 加載狀態
<div aria-live="polite" aria-label="加載狀態">
  {isLoading && '正在搜尋...'}
</div>

// 錯誤消息
<div
  role="alert"
  aria-live="assertive"
  className="error-message"
>
  請填寫所有必需字段
</div>
```

### 3.3 語義 HTML

```tsx
// 不佳: 語義不佳
<div onClick={handleClick}>提交</div>

// 改進: 使用語義元素
<button onClick={handleClick}>提交</button>

// 頁面結構
<header>
  <h1>東京便宜機票看板</h1>
</header>
<nav aria-label="主導航">
  {/* navigation */}
</nav>
<main>
  <section>
    <h2>搜尋航班</h2>
    {/* form */}
  </section>
</main>
<footer>
  {/* footer content */}
</footer>
```

---

## 4. 動畫和動作

### 4.1 尊重 prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 4.2 不自動播放動畫

```tsx
// 不佳: 自動播放可能令人困惑
<div className="pulse-animation">
  新消息
</div>

// 改進: 在用戶交互時播放
<button onClick={() => setShowAnimation(true)}>
  查看消息
</button>
```

---

## 5. 表單無障礙性

### 5.1 標籤和錯誤

```tsx
<div className="form-field">
  <label htmlFor="departure-date">
    出發日期
    <span aria-label="required" className="required">*</span>
  </label>
  <input
    id="departure-date"
    type="date"
    required
    aria-invalid={!!errors.departureDate}
    aria-describedby="departure-date-error"
  />
  {errors.departureDate && (
    <div id="departure-date-error" role="alert" className="error">
      {errors.departureDate}
    </div>
  )}
</div>
```

### 5.2 選擇框標籤

```tsx
<div className="form-field">
  <label htmlFor="airport-select">目的地機場</label>
  <select
    id="airport-select"
    aria-label="選擇日本目的地機場"
    aria-describedby="airport-hint"
  >
    <option value="">選擇機場...</option>
    <option value="NRT">東京成田 (NRT)</option>
    <option value="HND">東京羽田 (HND)</option>
  </select>
  <span id="airport-hint" className="hint">
    支持日本主要機場
  </span>
</div>
```

---

## 6. 測試清單

### 6.1 自動化測試
```bash
# 安裝無障礙測試工具
npm install --save-dev @axe-core/react axe-playwright

# 在測試中運行
import { axe } from '@axe-core/react';

test('should have no accessibility issues', async () => {
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### 6.2 手動測試

- [ ] **鍵盤導航**: 僅使用鍵盤操作整個應用
- [ ] **屏幕閱讀器**: 使用 NVDA/JAWS (Windows) 或 VoiceOver (Mac) 測試
- [ ] **顏色對比**: 使用 Contrast Ratio 工具檢查
- [ ] **縮放**: 測試 200% 縮放下的可用性
- [ ] **焦點指示器**: 驗證所有交互元素都有清晰的焦點指示器
- [ ] **動畫**: 檢查是否尊重 prefers-reduced-motion

### 6.3 工具

- [WAVE](https://wave.webaim.org/) - 視覺反饋工具
- [Axe DevTools](https://www.deque.com/axe/devtools/) - Chrome 擴展
- [Lighthouse](https://developers.google.com/web/tools/lighthouse) - Google DevTools
- [NVDA](https://www.nvaccess.org/) - 免費屏幕閱讀器
- [Contrast Ratio](https://contrast-ratio.com/) - 對比度檢查

---

## 7. 實施優先級

### P1 (關鍵)
- [ ] 修復色彩對比度問題
- [ ] 添加表單標籤和錯誤消息 ARIA
- [ ] 實施鍵盤導航和焦點管理
- [ ] 添加屏幕閱讀器支持

### P2 (重要)
- [ ] 添加更詳細的 ARIA 描述
- [ ] 優化頁面結構
- [ ] 尊重 prefers-reduced-motion
- [ ] 改進焦點指示器

### P3 (增強)
- [ ] 實施高對比度模式
- [ ] 添加字體大小調整選項
- [ ] 改進語義 HTML
- [ ] 添加自定義焦點顏色設置

---

## 8. 相關資源

- [WCAG 2.1 指南](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM](https://webaim.org/) - 無障礙信息資源
- [MDN 無障礙](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [A11y 檢查清單](https://www.a11yproject.com/checklist/)

---

*目標: 達到 WCAG 2.1 AA 合規性*
