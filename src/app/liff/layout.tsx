/**
 * LIFF 共用 layout — 把 _styles/tokens.css 套到所有 /liff/* 子路由。
 *
 * 為何放這層而不是 src/app/layout.tsx：
 *   - 公開首頁 (src/app/page.tsx) 用淺色 light theme
 *   - LIFF 三頁未來會統一改成 iOS dark mode (PR #3/4)
 *   - tokens.css 只定義 :root CSS 變數，不強制 body 樣式 — 目前還是
 *     light theme 的 SearchFormV2 / SettingsViewV2 也可以安全引入
 *
 * Next.js App Router 會自動將 nested layout 套到所有子路由 — 不用在
 * 每個 page.tsx 個別 import。Root layout (src/app/layout.tsx) 已 import
 * globals.css，這裡只加 tokens.css。
 */
import './_styles/tokens.css';

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
