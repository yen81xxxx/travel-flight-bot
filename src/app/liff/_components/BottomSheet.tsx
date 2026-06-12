'use client';

/**
 * BottomSheet — 共用 iOS-style 下方滑出視窗 wrapper
 *
 * 3 個 sheet (WatchDetailSheet / AddWatchSheet / SettingsSheet) 都用這支，
 * 避免每個 sheet 各自實作 backdrop / ESC / scroll-lock。
 *
 * 功能：
 *   - open=true 時 fade-in backdrop + slide-up sheet（CSS transition）
 *   - backdrop 點擊 → onClose
 *   - ESC → onClose
 *   - 開啟時 body scroll lock（避免背景跟著滾）
 *
 * 不做的事（PR #4a 範圍內 KISS）：
 *   - 拖曳關閉（手機 swipe-down）— 之後有需要再加，jsdom 也不好測
 *   - 多 sheet 疊加（每次只開一個，WatchlistView 用 state 控制）
 */
import * as React from 'react';
import { useEffect } from 'react';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 標題（左上） */
  title?: React.ReactNode;
  /** 副標 — 小字、在標題下 */
  subtitle?: React.ReactNode;
  /** 右上角額外的 action（例：刪除）— 預設是「×」close button */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, subtitle, headerRight, children }: Props): React.ReactElement {
  // ESC 關閉 + body scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <div
      className={`sheet-portal ${open ? 'open' : ''}`}
      aria-hidden={!open}
      data-testid="bottom-sheet"
      data-open={open ? 'true' : 'false'}
    >
      <div className="sheet-backdrop" onClick={onClose} data-testid="sheet-backdrop" />
      <div
        className="sheet-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={typeof title === 'string' ? 'sheet-title' : undefined}
        onClick={e => e.stopPropagation()}
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="sheet-head">
          <div className="sheet-head-left">
            {title && <div id="sheet-title" className="sheet-title">{title}</div>}
            {subtitle && <div className="sheet-sub">{subtitle}</div>}
          </div>
          <div className="sheet-head-right">
            {headerRight}
            <button type="button" className="sheet-close" onClick={onClose} aria-label="關閉">
              <Icon name="close" size={18} stroke={2.2} />
            </button>
          </div>
        </header>
        <div className="sheet-body">{children}</div>
      </div>

      <style jsx>{`
        .sheet-portal {
          position: fixed;
          inset: 0;
          z-index: 100;
          pointer-events: none;
        }
        .sheet-portal.open { pointer-events: auto; }
        .sheet-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(4px);
          opacity: 0;
          transition: opacity 0.22s ease;
        }
        .sheet-portal.open .sheet-backdrop { opacity: 1; }
        .sheet-card {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          max-height: 92vh;
          background: var(--ios-bg-secondary);
          color: var(--ios-label);
          border-radius: 22px 22px 0 0;
          transform: translateY(100%);
          transition: transform 0.28s cubic-bezier(0.32, 0.72, 0.16, 1);
          display: flex;
          flex-direction: column;
        }
        .sheet-portal.open .sheet-card { transform: translateY(0); }
        .sheet-grabber {
          width: 36px;
          height: 4px;
          background: var(--ios-label-3);
          border-radius: 2px;
          margin: 8px auto 6px;
          opacity: 0.5;
        }
        .sheet-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 16px 12px;
          gap: 12px;
          border-bottom: 0.5px solid var(--ios-hairline);
        }
        .sheet-head-left { flex: 1; min-width: 0; }
        .sheet-title {
          font-size: 17px;
          font-weight: 700;
          color: var(--ios-label);
        }
        .sheet-sub {
          font-size: 12px;
          color: var(--ios-label-2);
          margin-top: 2px;
        }
        .sheet-head-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .sheet-close {
          appearance: none;
          background: var(--ios-fill-2);
          border: none;
          color: var(--ios-label);
          /* PR #21 §4.6a: tap target ≥44px（視覺圓仍 30px，點擊範圍用 padding 撐大） */
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-sizing: content-box;
          padding: 7px;
          background-clip: content-box;
        }
        .sheet-body {
          padding: 14px 16px 28px;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
      `}</style>
    </div>
  );
}

export default BottomSheet;
