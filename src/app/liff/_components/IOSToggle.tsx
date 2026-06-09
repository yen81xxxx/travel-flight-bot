/**
 * IOSToggle — iOS-style 開關（off=灰 / on=綠）
 *
 * 共用於：WatchDetailSheet 的「暫停追蹤」、SettingsSheet 的每日摘要 / 靜音時段。
 * 設計原樣參考 design_reference/vision/components.jsx VToggle。
 */
import * as React from 'react';

interface Props {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function IOSToggle({ on, onChange, disabled = false, ariaLabel }: Props): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`ios-toggle ${on ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => onChange(!on)}
      data-testid="ios-toggle"
      data-on={on ? 'true' : 'false'}
    >
      <span className="knob" />

      <style jsx>{`
        .ios-toggle {
          appearance: none;
          width: 50px;
          height: 30px;
          border: none;
          border-radius: 999px;
          background: var(--ios-fill);
          position: relative;
          cursor: pointer;
          transition: background 0.18s ease;
          flex-shrink: 0;
        }
        .ios-toggle.on { background: var(--ios-green); }
        .ios-toggle.disabled { opacity: 0.5; cursor: not-allowed; }
        .knob {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 26px;
          height: 26px;
          background: #fff;
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
          transition: transform 0.2s cubic-bezier(0.32, 0.72, 0.16, 1);
        }
        .ios-toggle.on .knob { transform: translateX(20px); }
      `}</style>
    </button>
  );
}

export default IOSToggle;
