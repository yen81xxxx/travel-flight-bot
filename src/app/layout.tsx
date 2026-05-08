import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '東京便宜機票看板',
  description: '每日自動更新東京航班最低價'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
