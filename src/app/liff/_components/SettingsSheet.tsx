'use client';

/**
 * SettingsSheet — 右上角 gear 開出來的全域設定 sheet
 *
 * 設計手冊 §4.5。剩下 3 項全域設定：
 *   - 每日摘要 toggle (8am digest)
 *   - 靜音時段 toggle + 起迄時間 (HH:MM)
 *   - 新追蹤的預設通知對象 segmented (我 / 群組)（暫先固定「我」，PR #4b 再接後端）
 *
 * 後端對應現有 /api/notification-settings (GET / POST)。
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { IOSToggle } from './IOSToggle';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  sourceId: string | null;
}

interface SettingsState {
  dailySummary: boolean;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

const DEFAULT_STATE: SettingsState = {
  dailySummary: true,
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00'
};

export function SettingsSheet({ open, onClose, sourceId }: Props): React.ReactElement {
  const [state, setState] = useState<SettingsState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // 開 sheet 時撈一次目前設定
  useEffect(() => {
    if (!open || !sourceId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/notification-settings?sourceId=${encodeURIComponent(sourceId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.settings) {
          const s = data.settings;
          setState({
            // 後端目前用 daily_summary 欄位（可能還沒 schema 化全部）→ 預設 true
            dailySummary: s.daily_summary !== false,
            quietEnabled: !!(s.quiet_start && s.quiet_end),
            quietStart: s.quiet_start ?? '22:00',
            quietEnd: s.quiet_end ?? '08:00'
          });
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, sourceId]);

  const handleSave = async () => {
    if (!sourceId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/notification-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId,
          quietStart: state.quietEnabled ? state.quietStart : null,
          quietEnd: state.quietEnabled ? state.quietEnd : null,
          timezone: 'Asia/Taipei',
          dailySummary: state.dailySummary
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '儲存失敗');
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="設定" subtitle="通知 · 靜音 · 預設選項">
      {!sourceId ? (
        <div className="hint">需要先登入 LINE 才能調整通知設定。</div>
      ) : loading ? (
        <div className="hint">載入中…</div>
      ) : (
        <>
          {/* 每日摘要 */}
          <div className="set-row">
            <div className="set-row-left">
              <div className="set-row-title">每日摘要</div>
              <div className="set-row-desc">每天 8:00 推送所有追蹤的最新價</div>
            </div>
            <IOSToggle
              on={state.dailySummary}
              onChange={v => setState(s => ({ ...s, dailySummary: v }))}
              ariaLabel="每日摘要"
            />
          </div>

          {/* 靜音時段 */}
          <div className="set-row">
            <div className="set-row-left">
              <div className="set-row-title">靜音時段</div>
              <div className="set-row-desc">這段時間累積、結束後一起送</div>
            </div>
            <IOSToggle
              on={state.quietEnabled}
              onChange={v => setState(s => ({ ...s, quietEnabled: v }))}
              ariaLabel="靜音時段"
            />
          </div>
          {state.quietEnabled && (
            <div className="quiet-range">
              <label>
                <span>從</span>
                <input
                  type="time"
                  value={state.quietStart}
                  onChange={e => setState(s => ({ ...s, quietStart: e.target.value }))}
                />
              </label>
              <label>
                <span>到</span>
                <input
                  type="time"
                  value={state.quietEnd}
                  onChange={e => setState(s => ({ ...s, quietEnd: e.target.value }))}
                />
              </label>
            </div>
          )}

          {/* 預設通知對象 — PR #4a 先固定「我」，PR #4b 接後端 */}
          <div className="set-row defaults-row">
            <div className="set-row-left">
              <div className="set-row-title">新追蹤的預設通知對象</div>
              <div className="set-row-desc">新訂閱建立時帶上的預設。個別追蹤可在詳細頁覆寫。</div>
            </div>
            <div className="default-locked">通知我</div>
          </div>

          {error && (
            <div className="alert"><Icon name="warning" size={14} /> <span>{error}</span></div>
          )}

          <button className="save-btn" type="button" onClick={handleSave} disabled={saving}>
            {saving
              ? <><Icon name="hourglass" size={15} /> <span>儲存中…</span></>
              : savedFlash
                ? <><Icon name="check" size={15} /> <span>已儲存</span></>
                : <span>儲存設定</span>}
          </button>

          <p className="footnote">
            個別追蹤的目標價、時段、通知對象可以在卡片詳細頁覆寫。
          </p>
        </>
      )}

      <style jsx>{`
        .hint {
          padding: 32px 8px;
          text-align: center;
          color: var(--ios-label-2);
        }
        .set-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 14px 4px;
          border-bottom: 0.5px solid var(--ios-hairline);
        }
        .set-row:last-of-type { border-bottom: none; }
        .set-row-left { flex: 1; min-width: 0; }
        .set-row-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--ios-label);
        }
        .set-row-desc {
          font-size: 12px;
          color: var(--ios-label-2);
          margin-top: 2px;
        }
        .defaults-row { border-bottom: none; }
        .default-locked {
          font-size: 12.5px;
          color: var(--ios-label-2);
          background: var(--ios-fill-2);
          padding: 4px 10px;
          border-radius: 999px;
        }
        .quiet-range {
          display: flex;
          gap: 14px;
          padding: 0 4px 10px;
          border-bottom: 0.5px solid var(--ios-hairline);
        }
        .quiet-range label {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: var(--ios-label-2);
        }
        .quiet-range input {
          background: var(--ios-fill-2);
          border: none;
          border-radius: var(--r-field);
          padding: 10px 12px;
          color: var(--ios-label);
          font-size: 15px;
          font-family: var(--mono);
        }
        .alert {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255, 69, 58, 0.16);
          color: var(--ios-red);
          padding: 10px 12px;
          border-radius: var(--r-field);
          margin-top: 14px;
          font-size: 13px;
        }
        .save-btn {
          appearance: none;
          border: none;
          background: var(--ios-blue);
          color: #fff;
          width: 100%;
          padding: 14px;
          border-radius: var(--r-field);
          font-size: 15px;
          font-weight: 700;
          margin-top: 18px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .footnote {
          margin-top: 14px;
          font-size: 11.5px;
          color: var(--ios-label-3);
          line-height: 1.5;
        }
      `}</style>
    </BottomSheet>
  );
}

export default SettingsSheet;
