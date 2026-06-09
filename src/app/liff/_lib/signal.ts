/**
 * Buy-signal logic — currentBest vs target (廉航目標)
 *
 * 從 design_handoff_travl_vision/design_reference/vision/data.jsx 移植，
 * 規則 verbatim，handoff README §4.2 也明確規定門檻不准改：
 *
 *   currentBest <= target             → 'hit'      已達標 · 建議入手 (綠 · target icon)
 *   currentBest <= target * 1.08      → 'near'     接近目標 · 再等等 (黃 · flame icon)
 *   else                              → 'watching' 監控中            (灰 · eye icon)
 *
 * SIGNAL_META 內 color/bg 用 CSS 變數 — Sparkline/PriceChart/SignalPill 直接套，
 * 不在 component 裡重複定義顏色（避免 theme 不一致）。
 */
import type { IconName } from '../_components/Icon';

export type Signal = 'hit' | 'near' | 'watching';

/** 算 signal — 沒有 currentBest（quote==null）的情境，caller 應該直接傳 'watching' 字面值 */
export function deriveSignal(currentBest: number, targetLcc: number): Signal {
  if (currentBest <= targetLcc) return 'hit';
  if (currentBest <= targetLcc * 1.08) return 'near';
  return 'watching';
}

export interface SignalMeta {
  label: string;
  /** 副標 — watching 沒有副標 */
  sub: string | null;
  /** 前景色 CSS var */
  color: string;
  /** 背景底色（半透明） */
  bg: string;
  /** 對應 Icon name */
  icon: IconName;
}

export const SIGNAL_META: Record<Signal, SignalMeta> = {
  hit: {
    label: '已達標',
    sub: '建議入手',
    color: 'var(--ios-green)',
    bg: 'rgba(48,209,88,0.16)',
    icon: 'target'
  },
  near: {
    label: '接近目標',
    sub: '再等等',
    color: 'var(--ios-yellow)',
    bg: 'rgba(255,214,10,0.14)',
    icon: 'flame'
  },
  watching: {
    label: '監控中',
    sub: null,
    color: 'var(--ios-label-2)',
    bg: 'var(--ios-fill-2)',
    icon: 'eye'
  }
};
