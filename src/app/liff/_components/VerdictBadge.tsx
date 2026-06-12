/**
 * VerdictBadge — 統一的 verdict 徽章（手冊 §4.8）
 *
 * 卡片 + detail hero + digest 共用一顆，視覺語言一致：
 *   - buy（建議入手）→ strong：實心綠底 + 深綠字（最高優先視覺）
 *   - lean-buy / watch / wait → tinted：VERDICT_META 的 color/bg
 *   - size="sm" 給卡片用（小一號）
 *
 * 取代卡片上舊的 SignalPill（hit/near/watching 三態，PR #3 時代產物）。
 * SignalPill 保留給「沒有 intel 的 graceful degrade」路徑。
 *
 * 從 design_reference/vision/components.jsx VerdictBadge 1:1 port。
 */
import * as React from 'react';
import type { PriceIntelReady } from '../_types';
import { VERDICT_META } from '../_lib/priceIntel';
import { Icon, type IconName, ICON_NAMES } from './Icon';

interface Props {
  /** ready 狀態的 intel（building 不該 render 這顆 — caller 自己 gate） */
  intel: Pick<PriceIntelReady, 'verdict'>;
  size?: 'sm' | 'md';
}

function safeIconName(name: string): IconName {
  return (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : 'info';
}

export function VerdictBadge({ intel, size = 'md' }: Props): React.ReactElement {
  const m = VERDICT_META[intel.verdict] ?? VERDICT_META.watch;
  const strong = intel.verdict === 'buy';
  return (
    <span
      className={`verdict-badge ${strong ? 'strong' : ''} ${size === 'sm' ? 'sm' : ''}`}
      style={strong ? undefined : { color: m.color, background: m.bg }}
      data-testid="verdict-badge"
      data-verdict={intel.verdict}
    >
      <Icon name={safeIconName(m.icon)} size={size === 'sm' ? 12 : 14} stroke={2.3} />
      {m.label}

      <style jsx>{`
        .verdict-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 700;
          padding: 6px 12px 6px 9px;
          border-radius: 999px;
          letter-spacing: -0.1px;
          white-space: nowrap;
        }
        .verdict-badge.strong {
          color: #06351a;
          background: var(--ios-green);
        }
        .verdict-badge.sm {
          font-size: 12px;
          padding: 5px 11px 5px 8px;
        }
      `}</style>
    </span>
  );
}

export default VerdictBadge;
