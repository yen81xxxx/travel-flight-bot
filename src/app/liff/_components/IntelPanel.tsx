/**
 * IntelPanel — WatchDetailSheet 的「為什麼建議買 / 等」面板
 *
 * 分成兩種狀態，由 caller 直接傳 intel 進來，PR #5 邏輯/呈現分離：
 *
 *   - status='building'：顯示「情報建立中，再 N 天解鎖」+ 進度條 +「同時仍會跑目標價提醒」
 *     ⚠️ **絕對不能**顯示 verdict / headline — 這是產品定位（PRODUCT_STRATEGY §5 的 honesty gate）
 *
 *   - status='ready'：
 *     - verdict badge + 大 headline ("現在就是好時機" / "目前偏高，建議再等" 等)
 *     - PercentileBar (即時看「現在便宜還是貴」)
 *     - reasoning bullets (每條都有 icon + 一句話「為什麼」)
 *     - confidence pill (高 / 中 / 低 — 不騙人)
 */
import * as React from 'react';
import type { PriceIntel } from '../_types';
import { Icon, type IconName, ICON_NAMES } from './Icon';
import { PercentileBar } from './PercentileBar';
import { VerdictBadge } from './VerdictBadge';

interface Props {
  intel: PriceIntel;
}

/** Type-safe icon name fallback — 設計手冊 reason 寫 'sliders'/'trendDown' 等都在 ICON_NAMES 內 */
function safeIconName(name: string): IconName {
  return (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : 'info';
}

export function IntelPanel({ intel }: Props): React.ReactElement {
  if (intel.status === 'building') {
    return (
      <div className="intel-panel building" data-testid="intel-panel-building">
        <div className="ip-eyebrow">
          <Icon name="hourglass" size={12} stroke={2} />
          <span>情報建立中</span>
        </div>
        <div className="ip-building-headline">
          再 <strong className="tnum">{intel.remaining}</strong> 天可以下判斷
        </div>
        <div className="ip-progress">
          <div className="ip-progress-fill" style={{ width: `${intel.pct}%` }} />
        </div>
        <div className="ip-progress-label tnum">
          已累積 {intel.tracked} / {intel.target} 天的歷史
        </div>
        <p className="ip-note">
          資料夠之前不會強行給判斷 — 目標價提醒仍正常運作，跌破設定價會立刻通知。
        </p>
        <style jsx>{styles}</style>
      </div>
    );
  }

  // status === 'ready'
  // PR #20: badge 換用統一 VerdictBadge（手冊 §4.8 — 卡片/hero/digest 同一顆）
  return (
    <div className="intel-panel ready" data-testid="intel-panel-ready" data-verdict={intel.verdict}>
      <div className="ip-eyebrow">
        <Icon name="sparkle" size={12} stroke={2} />
        <span>智能判斷 · 信心度 {intel.confidence}</span>
      </div>
      <div className="ip-headline-row">
        <VerdictBadge intel={intel} />
        <span className="ip-headline">{intel.headline}</span>
      </div>

      <div className="ip-bar-wrap">
        <PercentileBar percentile={intel.percentile} />
      </div>

      <ul className="ip-reasons">
        {intel.reasons.map((r, i) => (
          <li key={i}>
            <Icon name={safeIconName(r.icon)} size={13} stroke={2} />
            <span>{r.t}</span>
          </li>
        ))}
      </ul>

      <style jsx>{styles}</style>
    </div>
  );
}

const styles = `
  .intel-panel {
    background: var(--card-grad);
    border: 1px solid var(--ios-hairline);
    border-radius: var(--r-card);
    padding: 14px;
    margin-top: 14px;
  }
  .ip-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--ios-label-3);
    letter-spacing: 1.4px;
    text-transform: uppercase;
  }
  .ip-headline-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .ip-headline {
    font-size: 17px;
    font-weight: 700;
    color: var(--ios-label);
    letter-spacing: -0.2px;
  }
  .ip-bar-wrap {
    margin-top: 12px;
  }
  .ip-reasons {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ip-reasons li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--ios-label-2);
  }
  /* ---- building ---- */
  .ip-building-headline {
    font-size: 17px;
    font-weight: 700;
    color: var(--ios-label);
    margin-top: 6px;
    letter-spacing: -0.2px;
  }
  .ip-building-headline strong {
    font-size: 22px;
    color: var(--ios-blue);
    font-weight: 800;
  }
  .ip-progress {
    height: 6px;
    background: var(--ios-fill-2);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 10px;
  }
  .ip-progress-fill {
    height: 100%;
    background: var(--ios-blue);
    transition: width 0.4s ease;
  }
  .ip-progress-label {
    font-size: 11.5px;
    color: var(--ios-label-3);
    margin-top: 4px;
  }
  .ip-note {
    margin: 12px 0 0;
    font-size: 11.5px;
    color: var(--ios-label-3);
    line-height: 1.55;
  }
`;

export default IntelPanel;
