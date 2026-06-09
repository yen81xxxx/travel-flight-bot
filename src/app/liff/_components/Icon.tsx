/**
 * LIFF 共用 icon — SF Symbols 風 linear stroke icon set.
 *
 * 用法：<Icon name="airplane" size={20} stroke={2} />
 *
 * Origin: 從 design_handoff_travl_vision/design_reference/icons.jsx 移植，
 * 對 paths map 1:1 verbatim port（手冊規定）。
 *
 * 設計原則：
 *   - 統一用 currentColor stroke，讓 parent color 決定 icon 色
 *   - 24-grid viewBox 不變
 *   - 不可用 emoji，所有畫面圖示走這支
 *
 * 加新 icon：
 *   1. 把 path 加到 PATHS map
 *   2. 把 name 加到 IconName union type
 *   3. Icon snapshot test 自動覆蓋（用 ICON_NAMES 跑 forEach）
 */
import * as React from 'react';

/** 所有支援的 icon name — 加新 icon 時順手加進來 */
export const ICON_NAMES = [
  // nav / tabs
  'search', 'bell', 'gear',
  // flight
  'airplane', 'takeoff', 'landing', 'swap', 'arrowRight',
  // time / date
  'calendar', 'clock', 'hourglass', 'moon', 'sun',
  // chevrons / arrows
  'chevronRight', 'chevronLeft', 'chevronDown', 'chevronUp',
  // actions
  'check', 'checkCircle', 'close', 'pencil', 'trash', 'plus',
  // people
  'person', 'people',
  // misc
  'tag', 'bolt', 'sparkle', 'info', 'warning', 'box', 'waveHand', 'party',
  // vision / data-viz
  'target', 'trendDown', 'trendUp', 'chartLine', 'sliders',
  'pause', 'play', 'eye', 'bookmark', 'bellRing', 'dot', 'flame', 'arrowDownRight'
] as const;

export type IconName = typeof ICON_NAMES[number];

interface IconProps {
  name: IconName;
  /** px, defaults 22 */
  size?: number;
  /** stroke-width, defaults 1.8 */
  stroke?: number;
  className?: string;
  style?: React.CSSProperties;
  /** override color via className/style; defaults to currentColor */
  title?: string;
}

/** 共用 stroke 屬性，所有 path/circle/rect 都套上 */
const STROKE = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
};

/**
 * icon name → React.ReactNode (SVG fragment)
 * 接受 stroke-width 為參數讓所有元素共用同一 stroke-width
 */
function renderPath(name: IconName, sw: number): React.ReactNode {
  const p = { ...STROKE, strokeWidth: sw };
  switch (name) {
    // ---- nav / tabs ----
    case 'search':
      return <><circle cx="11" cy="11" r="7" {...p} /><path d="M21 21l-4.3-4.3" {...p} /></>;
    case 'bell':
      return <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" {...p} /><path d="M13.7 21a2 2 0 0 1-3.4 0" {...p} /></>;
    case 'gear':
      return <><circle cx="12" cy="12" r="3.2" {...p} /><path d="M12 2.5l1.3 2.2 2.5-.5.4 2.5 2.3 1-.9 2.4 1.7 1.9-1.7 1.9.9 2.4-2.3 1-.4 2.5-2.5-.5L12 21.5l-1.3-2.2-2.5.5-.4-2.5-2.3-1 .9-2.4L4.7 12l1.7-1.9-.9-2.4 2.3-1 .4-2.5 2.5.5z" {...p} /></>;

    // ---- flight ----
    case 'airplane':
      return <path d="M21 16.5v-1.7l-7.5-4.3V5.2a1.5 1.5 0 0 0-3 0v5.3L3 14.8v1.7l7.5-2.1v4.2L8.6 20v1.3l3.4-.9 3.4.9V20l-1.9-1.4v-4.2L21 16.5z" {...p} />;
    case 'takeoff':
      return <><path d="M2.5 19h19" {...p} /><path d="M4 14.5l3 .4 4.5-1.2 6.8-1.8a1.6 1.6 0 0 0-.8-3.1l-3.7 1-4.6-4 -2.2.6 2.6 4.4-3.5.9L3 9.3l-1.6.4 1 3.4 1.1 1.4z" {...p} /></>;
    case 'landing':
      return <><path d="M2.5 19h19" {...p} /><path d="M3.6 11.2l2.7 1.4 4.6.4 7-.2a1.6 1.6 0 0 0 .2-3.2l-3.8-.6-3.2-5.1-2.2-.2 1.1 5-3.6-.4-2-2L3 6.6l.1 3.5.5 1.1z" {...p} /></>;
    case 'swap':
      return <><path d="M7 4v15M7 19l-3.2-3.2M7 19l3.2-3.2" {...p} /><path d="M17 20V5M17 5l-3.2 3.2M17 5l3.2 3.2" {...p} /></>;
    case 'arrowRight':
      return <path d="M5 12h14M14 7l5 5-5 5" {...p} />;

    // ---- time / date ----
    case 'calendar':
      return <><rect x="3.5" y="4.5" width="17" height="16" rx="3" {...p} /><path d="M3.5 9h17M8 2.5v4M16 2.5v4" {...p} /></>;
    case 'clock':
      return <><circle cx="12" cy="12" r="8.5" {...p} /><path d="M12 7.5V12l3 2" {...p} /></>;
    case 'hourglass':
      return <><path d="M7 3h10M7 21h10" {...p} /><path d="M7 3c0 4 2.5 5.5 5 9 2.5-3.5 5-5 5-9M7 21c0-4 2.5-5.5 5-9 2.5 3.5 5 5 5 9" {...p} /></>;
    case 'moon':
      return <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" {...p} />;
    case 'sun':
      return <><circle cx="12" cy="12" r="4" {...p} /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" {...p} /></>;

    // ---- chevrons / arrows ----
    case 'chevronRight':
      return <path d="M9 5l7 7-7 7" {...p} />;
    case 'chevronLeft':
      return <path d="M15 5l-7 7 7 7" {...p} />;
    case 'chevronDown':
      return <path d="M5 9l7 7 7-7" {...p} />;
    case 'chevronUp':
      return <path d="M5 15l7-7 7 7" {...p} />;

    // ---- actions ----
    case 'check':
      return <path d="M4 12.5l5 5 11-11" {...p} />;
    case 'checkCircle':
      return <><circle cx="12" cy="12" r="9" {...p} /><path d="M8 12.5l2.5 2.5L16 9.5" {...p} /></>;
    case 'close':
      return <path d="M6 6l12 12M18 6L6 18" {...p} />;
    case 'pencil':
      return <><path d="M4 20h4L19 9l-4-4L4 16v4z" {...p} /><path d="M14 6l4 4" {...p} /></>;
    case 'trash':
      return <><path d="M4 7h16M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" {...p} /><path d="M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4L18 7" {...p} /></>;
    case 'plus':
      return <path d="M12 5v14M5 12h14" {...p} />;

    // ---- people ----
    case 'person':
      return <><circle cx="12" cy="8" r="3.8" {...p} /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" {...p} /></>;
    case 'people':
      return <><circle cx="9" cy="8.5" r="3.3" {...p} /><path d="M3 19.5c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3" {...p} /><path d="M16 5.5a3.3 3.3 0 0 1 0 6.4M17.5 19.5c0-2.6-1-4.4-2.8-5.3" {...p} /></>;

    // ---- misc ----
    case 'tag':
      return <><path d="M3.5 12.5l8-8a2 2 0 0 1 1.4-.6l5 .1a2 2 0 0 1 2 2l.1 5a2 2 0 0 1-.6 1.4l-8 8a2 2 0 0 1-2.8 0l-4.5-4.5a2 2 0 0 1 0-2.9z" {...p} /><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" /></>;
    case 'bolt':
      return <path d="M13 2.5L5 13h5.5l-1 8.5L18 11h-5.5l.5-8.5z" {...p} />;
    case 'sparkle':
      return <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" {...p} />;
    case 'info':
      return <><circle cx="12" cy="12" r="9" {...p} /><path d="M12 11v5M12 7.8v.2" {...p} /></>;
    case 'warning':
      return <><path d="M12 3.5L2.5 20h19L12 3.5z" {...p} /><path d="M12 10v4M12 17.2v.2" {...p} /></>;
    case 'box':
      return <><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z" {...p} /><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" {...p} /></>;
    case 'waveHand':
      return <path d="M7 11V6.5a1.4 1.4 0 0 1 2.8 0V11m0-1.5V5a1.4 1.4 0 0 1 2.8 0v5m0-.5V6a1.4 1.4 0 0 1 2.8 0v6.5c0 4-2.5 6.5-6 6.5-2 0-3.4-.8-4.6-2.3L2.4 14a1.5 1.5 0 0 1 2.2-2l1.4 1.3" {...p} />;
    case 'party':
      return <><path d="M3 21l4.5-12 7.5 7.5L3 21z" {...p} /><path d="M14 4l.5 1.5M19.5 4.5L18 6M20 10l-1.5-.3M16 8a4 4 0 0 0-4-4" {...p} /></>;

    // ---- vision / data-viz ----
    case 'target':
      return <><circle cx="12" cy="12" r="8.5" {...p} /><circle cx="12" cy="12" r="4.5" {...p} /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>;
    case 'trendDown':
      return <><path d="M3 7l7 7 4-4 7 7" {...p} /><path d="M21 12v5h-5" {...p} /></>;
    case 'trendUp':
      return <><path d="M3 17l7-7 4 4 7-7" {...p} /><path d="M21 12V7h-5" {...p} /></>;
    case 'chartLine':
      return <><path d="M4 4v15a1 1 0 0 0 1 1h15" {...p} /><path d="M7 14l3.5-4 3 2.5L20 7" {...p} /></>;
    case 'sliders':
      return <><path d="M4 8h10M18 8h2M4 16h2M10 16h10" {...p} /><circle cx="16" cy="8" r="2.2" {...p} /><circle cx="8" cy="16" r="2.2" {...p} /></>;
    case 'pause':
      return <><rect x="6.5" y="5" width="3.4" height="14" rx="1.2" {...p} /><rect x="14.1" y="5" width="3.4" height="14" rx="1.2" {...p} /></>;
    case 'play':
      return <path d="M7 4.5l12 7.5-12 7.5V4.5z" {...p} />;
    case 'eye':
      return <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" {...p} /><circle cx="12" cy="12" r="3" {...p} /></>;
    case 'bookmark':
      return <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1z" {...p} />;
    case 'bellRing':
      return <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" {...p} /><path d="M13.7 21a2 2 0 0 1-3.4 0" {...p} /><path d="M20.5 4.5a5 5 0 0 1 1.3 3M3.5 4.5a5 5 0 0 0-1.3 3" {...p} /></>;
    case 'dot':
      return <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />;
    case 'flame':
      return <path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-1.5.5-2.5 1-3 0 1 .5 2 1.5 2 1.2 0 1.5-1.2 1-3-.3-1.2-.5-2.5.5-4z" {...p} />;
    case 'arrowDownRight':
      return <path d="M7 7l10 10M17 17v-7M17 17h-7" {...p} />;
  }
}

export function Icon({ name, size = 22, stroke = 1.8, className = '', style, title }: IconProps): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      // display: inline-block — Icon 通常直接放在中文文字旁邊（從 emoji 替換來的場景），
      // 預設 inline-block 才不會像 emoji 換 block 的 svg 那樣換行。
      // vertical-align: -0.15em 把 SVG 視覺中心對齊文字 x-height（baseline 對 svg 偏低）。
      // 設計手冊原本給的是 display: block，但他們所有 use case 都自帶 flex 容器；
      // 我們的 use case 是 inline 文字旁，故 deviate。要當大圖塊時自己 style={{display:'block'}}。
      style={{ display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0, ...(style ?? {}) }}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      data-icon={name}
    >
      {title ? <title>{title}</title> : null}
      {renderPath(name, stroke)}
    </svg>
  );
}

export default Icon;
