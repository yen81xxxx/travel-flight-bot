/**
 * ErrorState — fetch 失敗 / 離線時的全屏可重試狀態（取代一條 error banner）
 *
 * 設計手冊 §4.6 (design_reference/vision/states.jsx ErrorState 1:1 port)，
 * 2026 fintech 慣例：
 *   - 白話講問題、**不怪用戶**（「不是你的操作造成的」）
 *   - retry 按鈕 ≥44px tap target
 *   - 信任安撫：「追蹤與目標價都安全儲存在雲端」
 *   - role="alert" — screen reader 立刻播報
 *   - offline prop 切換文案（沒網路 vs 一般錯誤）
 */
import * as React from 'react';
import { Icon } from './Icon';

interface Props {
  /** true = 顯示離線文案；false = 一般載入失敗文案 */
  offline?: boolean;
  onRetry: () => void;
}

export function ErrorState({ offline = false, onRetry }: Props): React.ReactElement {
  return (
    <div className="err-state" role="alert" data-testid="error-state" data-offline={offline ? 'true' : 'false'}>
      <div className="err-icon">
        <Icon name={offline ? 'box' : 'warning'} size={30} stroke={1.8} />
      </div>
      <div className="err-title">{offline ? '目前沒有網路連線' : '暫時無法載入'}</div>
      <div className="err-desc">
        {offline
          ? '看起來你離線了。連上網路後，我們會自動重新載入你的追蹤清單。'
          : '載入追蹤清單時出了點問題，不是你的操作造成的。稍等一下再試一次。'}
      </div>
      <button type="button" className="err-retry pressable" onClick={onRetry} data-testid="error-retry">
        <Icon name="swap" size={16} stroke={2.2} style={{ transform: 'rotate(90deg)' }} />
        重新載入
      </button>
      <div className="err-note">
        <Icon name="info" size={13} stroke={1.9} style={{ color: 'var(--ios-green)' }} />
        放心，你設定的追蹤與目標價都安全儲存在雲端，不會因此遺失。
      </div>

      <style jsx>{`
        .err-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 13px;
          padding: 48px 24px 40px;
        }
        .err-icon {
          width: 64px;
          height: 64px;
          border-radius: 18px;
          background: rgba(255, 159, 10, 0.14);
          color: var(--ios-orange);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .err-title {
          font-size: 19px;
          font-weight: 700;
          color: var(--ios-label);
          letter-spacing: -0.3px;
        }
        .err-desc {
          font-size: 14px;
          color: var(--ios-label-2);
          line-height: 1.55;
          max-width: 280px;
        }
        .err-retry {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 4px;
          min-height: 44px;
          padding: 0 24px;
          background: var(--ios-blue);
          color: #fff;
          border: none;
          border-radius: 12px;
          font-family: inherit;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
        }
        .err-note {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          font-size: 12px;
          color: var(--ios-label-3);
          line-height: 1.45;
          max-width: 290px;
          margin-top: 6px;
        }
      `}</style>
    </div>
  );
}

export default ErrorState;
