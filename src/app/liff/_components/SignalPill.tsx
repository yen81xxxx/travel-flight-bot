/**
 * SignalPill — 顯示一筆訂閱的 buy signal（已達標 / 接近目標 / 監控中）
 *
 * 顏色 / icon / label 都從 SIGNAL_META 取（單一來源），不要在這檔內 hardcode。
 * 設計手冊 §4.2、design_reference/vision/components.jsx 1:1。
 */
import * as React from 'react';
import { SIGNAL_META, type Signal } from '../_lib/signal';
import { Icon } from './Icon';

interface Props {
  signal: Signal;
  /** 強制縮小字（卡片頂 row vs 內 row 用同一 component 但大小不同） */
  compact?: boolean;
}

export function SignalPill({ signal, compact = false }: Props): React.ReactElement {
  const m = SIGNAL_META[signal];
  return (
    <span
      className={`sig-pill ${compact ? 'compact' : ''}`}
      style={{ color: m.color, background: m.bg }}
      data-testid="signal-pill"
      data-signal={signal}
    >
      <Icon name={m.icon} size={14} stroke={2} />
      <span className="sig-label">{m.label}</span>
      {m.sub && <span className="sub">· {m.sub}</span>}

      <style jsx>{`
        .sig-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: var(--r-pill);
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
          white-space: nowrap;
        }
        .sig-pill.compact {
          padding: 3px 8px;
          font-size: 11px;
        }
        .sub {
          font-weight: 500;
          opacity: 0.9;
        }
      `}</style>
    </span>
  );
}

export default SignalPill;
