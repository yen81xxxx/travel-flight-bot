/**
 * EmptyOnboarding — 新用戶 / 0 追蹤時的 onboarding（取代一行式空狀態）
 *
 * 設計手冊 §4.6 (design_reference/vision/states.jsx EmptyOnboarding 1:1 port)：
 *   - hero：飛機 badge + 「開始追蹤第一條航線」+ value prop
 *   - 3 步驟 how-it-works（新增航線 → 每天追價 → 達標通知）
 *   - 熱門航線 quick-start chips（點了預填 AddWatchSheet）
 *   - 主 CTA「自訂新增追蹤」
 *   - trust note：「資料不足時我們會直說」— 跟 Price Intelligence 的 honesty gate 呼應
 *
 * caller (WatchlistView) 在顯示這個時要 **藏 FAB**（手冊規定，避免雙 CTA）。
 */
import * as React from 'react';
import { Icon, type IconName } from './Icon';

export interface QuickStartRoute {
  o: string;       // origin IATA
  d: string;       // destination IATA
  label: string;   // '台北 → 東京'
}

/** 熱門航線 — 手冊指定 4 條（TPE 出發 → 東京/大阪/福岡/札幌） */
export const POPULAR_ROUTES: QuickStartRoute[] = [
  { o: 'TPE', d: 'NRT', label: '台北 → 東京' },
  { o: 'TPE', d: 'KIX', label: '台北 → 大阪' },
  { o: 'TPE', d: 'FUK', label: '台北 → 福岡' },
  { o: 'TPE', d: 'CTS', label: '台北 → 札幌' }
];

const STEPS: { icon: IconName; t: string; s: string }[] = [
  { icon: 'plus', t: '新增一條航線', s: '選出發地、目的地、日期' },
  { icon: 'chartLine', t: '我們每天追價', s: '記錄價格、算出走勢與買進訊號' },
  { icon: 'bellRing', t: '達標就通知你', s: '跌破目標價，LINE 立刻提醒' }
];

interface Props {
  /** 主 CTA：開空白 AddWatchSheet */
  onAdd: () => void;
  /** 熱門 chip：開預填好路線的 AddWatchSheet */
  onQuickStart: (route: QuickStartRoute) => void;
}

export function EmptyOnboarding({ onAdd, onQuickStart }: Props): React.ReactElement {
  return (
    <div className="onb" data-testid="empty-onboarding">
      <div className="onb-hero">
        <div className="onb-badge">
          <Icon name="airplane" size={26} style={{ transform: 'rotate(90deg)' }} />
        </div>
        <h2 className="onb-title">開始追蹤第一條航線</h2>
        <p className="onb-sub">
          告訴我們你想飛的航線，剩下的交給我們——每天盯價、看準時機、跌破目標就通知你。
        </p>
      </div>

      <div className="onb-steps">
        {STEPS.map((s, i) => (
          <div key={i} className="onb-step">
            <div className="onb-step-num">{i + 1}</div>
            <div className="onb-step-icon"><Icon name={s.icon} size={18} stroke={1.9} /></div>
            <div className="onb-step-body">
              <div className="onb-step-t">{s.t}</div>
              <div className="onb-step-s">{s.s}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="onb-quick">
        <div className="onb-quick-label">熱門航線・一鍵開始</div>
        <div className="onb-quick-grid">
          {POPULAR_ROUTES.map((p) => (
            <button
              key={`${p.o}-${p.d}`}
              type="button"
              className="onb-quick-chip pressable"
              onClick={() => onQuickStart(p)}
              data-testid={`quick-start-${p.d}`}
            >
              <Icon name="airplane" size={14} style={{ transform: 'rotate(90deg)', color: 'var(--ios-blue)' }} />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="onb-cta pressable" onClick={onAdd} data-testid="onboarding-add">
        <Icon name="plus" size={19} stroke={2.3} />
        自訂新增追蹤
      </button>

      <div className="onb-trust">
        <Icon name="info" size={13} stroke={1.9} />
        資料不足時我們會直說「還在建立」，不會給你沒把握的建議。
      </div>

      <style jsx>{`
        .onb { display: flex; flex-direction: column; gap: 20px; padding: 8px 2px 40px; }
        .onb-hero {
          display: flex; flex-direction: column; align-items: center;
          text-align: center; gap: 12px; padding: 14px 12px 4px;
        }
        .onb-badge {
          width: 64px; height: 64px; border-radius: 20px;
          background: linear-gradient(135deg, rgba(10,132,255,0.22), rgba(10,132,255,0.08));
          border: 0.5px solid rgba(10,132,255,0.3);
          color: var(--ios-blue);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 8px 22px rgba(10,132,255,0.15);
        }
        .onb-title {
          font-size: 23px; font-weight: 800; color: var(--ios-label);
          margin: 0; letter-spacing: -0.5px;
        }
        .onb-sub {
          font-size: 14px; color: var(--ios-label-2);
          line-height: 1.55; margin: 0; max-width: 300px;
        }
        .onb-steps {
          display: flex; flex-direction: column; gap: 2px;
          background: var(--card-grad);
          border: 0.5px solid var(--ios-separator-2);
          border-radius: 16px; overflow: hidden;
        }
        .onb-step {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 15px; position: relative;
        }
        .onb-step + .onb-step::before {
          content: ''; position: absolute; top: 0; left: 15px; right: 0;
          height: 0.5px; background: var(--ios-hairline);
        }
        .onb-step-num {
          width: 22px; height: 22px; border-radius: 50%;
          background: var(--ios-fill-2); color: var(--ios-label-2);
          font-size: 12px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .onb-step-icon {
          width: 34px; height: 34px; border-radius: 10px;
          background: rgba(10,132,255,0.14); color: var(--ios-blue);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .onb-step-body { min-width: 0; }
        .onb-step-t { font-size: 15px; font-weight: 600; color: var(--ios-label); }
        .onb-step-s { font-size: 12px; color: var(--ios-label-2); margin-top: 2px; }
        .onb-quick { display: flex; flex-direction: column; gap: 10px; }
        .onb-quick-label {
          font-size: 12px; font-weight: 600; color: var(--ios-label-3);
          letter-spacing: 0.4px; text-transform: uppercase; padding: 0 2px;
        }
        .onb-quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .onb-quick-chip {
          display: flex; align-items: center; gap: 7px; padding: 13px 14px;
          background: var(--ios-fill-3);
          border: 0.5px solid var(--ios-separator-2); border-radius: 12px;
          color: var(--ios-label); font-family: inherit;
          font-size: 14px; font-weight: 600; cursor: pointer; letter-spacing: -0.2px;
          min-height: 44px;
        }
        .onb-cta {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          background: var(--ios-blue); color: #fff; border: none; border-radius: 14px;
          padding: 15px; font-family: inherit; font-size: 16px; font-weight: 700;
          cursor: pointer; box-shadow: 0 6px 18px rgba(10,132,255,0.35);
          min-height: 44px;
        }
        .onb-trust {
          display: flex; align-items: flex-start; gap: 7px;
          font-size: 12px; color: var(--ios-label-3);
          line-height: 1.45; padding: 0 4px;
        }
      `}</style>
    </div>
  );
}

export default EmptyOnboarding;
