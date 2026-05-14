import type { Metadata } from 'next';
import './globals.css';
import PerformanceMonitor from './PerformanceMonitor';
import ResourceHints from './ResourceHints';

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
      <head>
        <ResourceHints />
      </head>
      <body>
        <PerformanceMonitor />
        {children}
      </body>
    </html>
  );
}
