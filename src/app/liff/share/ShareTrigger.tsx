'use client';

import { useEffect, useState } from 'react';
import { useLiff } from '@/hooks/useLiff';

interface Props {
  liffId: string;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'not-in-line' }
  | { kind: 'unsupported' }
  | { kind: 'sharing' }
  | { kind: 'success' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

/**
 * /liff/share?o=TPE&d=HND&out=2027-01-30&ret=2027-02-04&max=23028&p=13414&a=台灣虎航
 *
 * 從 LINE Flex 卡片的 ↪ 按鈕點過來。讀 URL params → 組分享 Flex →
 * 呼 liff.shareTargetPicker → 結束後關 LIFF 視窗。
 *
 * 整頁是 loading 狀態（不畫表單），完成立刻 closeWindow()。
 */
export default function ShareTrigger({ liffId }: Props) {
  const { liffReady, isInLine } = useLiff(liffId);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    if (!liffReady) return;
    if (!isInLine) {
      setStatus({ kind: 'not-in-line' });
      return;
    }

    (async () => {
      try {
        const { default: liff } = await import('@line/liff');
        if (typeof (liff as { shareTargetPicker?: unknown }).shareTargetPicker !== 'function') {
          setStatus({ kind: 'unsupported' });
          return;
        }

        const params = new URLSearchParams(window.location.search);
        const origin = params.get('o') ?? '';
        const destination = params.get('d') ?? '';
        const outbound = params.get('out') ?? '';
        const ret = params.get('ret') ?? '';
        const max = params.get('max');
        const price = params.get('p');
        const airline = params.get('a');

        if (!origin || !destination) {
          setStatus({ kind: 'error', message: '缺少必要參數' });
          return;
        }

        const route = `${origin} → ${destination}`;
        const dates = `${outbound} ~ ${ret}`;
        const bodyContents: Array<Record<string, unknown>> = [
          { type: 'text', text: route, weight: 'bold', size: 'lg', color: '#1a2238' },
          { type: 'text', text: `📅 ${dates}`, size: 'sm', color: '#666666' }
        ];
        if (price) {
          bodyContents.push({
            type: 'text',
            text: `💰 目前最低 NT$ ${Number(price).toLocaleString()}${airline ? `（${airline}）` : ''}`,
            size: 'sm',
            color: '#22c55e',
            wrap: true,
            margin: 'md'
          });
        }
        if (max) {
          bodyContents.push({
            type: 'text',
            text: `🎯 我設的目標價 NT$ ${Number(max).toLocaleString()}`,
            size: 'sm',
            color: '#94a3b8',
            wrap: true
          });
        }
        bodyContents.push({
          type: 'text',
          text: '也想追？點下面加 bot 開始追蹤',
          size: 'xs',
          color: '#94a3b8',
          wrap: true,
          margin: 'md'
        });

        const botSearchUrl = liffId
          ? `https://liff.line.me/${liffId}`
          : `${typeof window !== 'undefined' ? window.location.origin : ''}/liff/search`;

        const flexMsg = {
          type: 'flex',
          altText: `✈️ 我在追 ${route} ${dates}`,
          contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#1a2238',
              paddingAll: '12px',
              contents: [
                { type: 'text', text: '✈️ 我發現一條好航線', weight: 'bold', size: 'md', color: '#ffffff' }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: bodyContents
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [{
                type: 'button',
                style: 'primary',
                color: '#1a2238',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: '👉 加 bot 開始追',
                  uri: botSearchUrl
                }
              }]
            }
          }
        };

        setStatus({ kind: 'sharing' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (liff as any).shareTargetPicker([flexMsg], { isMultiple: true });
        if (result && result.status === 'success') {
          setStatus({ kind: 'success' });
        } else {
          // 使用者取消
          setStatus({ kind: 'cancelled' });
        }
        // 0.8 秒後自動關閉 LIFF 視窗
        setTimeout(() => { try { liff.closeWindow(); } catch { /* ignore */ } }, 800);
      } catch (err) {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [liffReady, isInLine, liffId]);

  return (
    <div className="share-wrap">
      <div className="card">
        {status.kind === 'loading' && <p>📤 準備分享…</p>}
        {status.kind === 'sharing' && <p>📤 請選擇要分享給哪位朋友…</p>}
        {status.kind === 'success' && <p>✅ 已分享！</p>}
        {status.kind === 'cancelled' && <p>已取消分享</p>}
        {status.kind === 'not-in-line' && (
          <p>⚠️ 請從 LINE App 內開啟才能分享給好友</p>
        )}
        {status.kind === 'unsupported' && (
          <p>⚠️ 你的 LINE 版本不支援分享，請更新 LINE App</p>
        )}
        {status.kind === 'error' && (
          <p>❌ 分享失敗：{status.message}</p>
        )}
      </div>
      <style jsx>{`
        .share-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: #0a0e1a;
          font-family: -apple-system, 'PingFang TC', sans-serif;
        }
        .card {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 32px 24px;
          border-radius: 12px;
          color: #cbd5e1;
          font-size: 16px;
          text-align: center;
          max-width: 360px;
          width: 100%;
        }
      `}</style>
    </div>
  );
}
