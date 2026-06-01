'use client';

import { useEffect, useState } from 'react';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { useLiff } from '@/hooks/useLiff';
import { Alert, Badge, Button, Card, Spinner } from '@/components';
import TabNav from '../TabNav';

interface Props {
  liffId: string;
}

export default function SettingsViewV2({ liffId }: Props) {
  // LIFF 初始化
  const { liffReady, user } = useLiff(liffId);
  const sourceId = user?.userId ?? null;

  // 群組上下文（從 URL ?ctx= 或 sessionStorage 取）
  const [groupCtxId, setGroupCtxId] = useSessionStorage<string | null>('liff_ctx', null);

  // 初始化 ctx：先看 URL 再 fallback sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get('ctx');
    if (ctx && (ctx.startsWith('C') || ctx.startsWith('R'))) {
      setGroupCtxId(ctx);
    }
  }, [setGroupCtxId]);

  // 設定狀態
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [dailySummary, setDailySummary] = useState(true);
  const [priceAlerts, setPriceAlerts] = useState(true);

  // UI 狀態
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 初始化設定
  useEffect(() => {
    if (!sourceId) return;

    const targetSourceId = groupCtxId ?? sourceId;
    setError(null);

    fetch(`/api/notification-settings?sourceId=${encodeURIComponent(targetSourceId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.settings) {
          // API 回 snake_case，前端用 camelCase
          const s = data.settings;
          // quietStart/quietEnd 為 null 代表「靜音關閉」
          const hasQuiet = s.quiet_start != null && s.quiet_end != null;
          setQuietStart(s.quiet_start || '22:00');
          setQuietEnd(s.quiet_end || '08:00');
          setQuietEnabled(hasQuiet);
          setDailySummary(s.daily_summary !== false);
          setPriceAlerts(s.price_alerts !== false);
        }
      })
      .catch(err => setError(err.message));
  }, [sourceId, groupCtxId]);

  // 保存設定
  const handleSave = async () => {
    if (!sourceId) return;

    setSaving(true);
    setError(null);
    setSavedMsg(null);

    try {
      const targetSourceId = groupCtxId ?? sourceId;
      // quietEnabled === false → start/end 送 null 才能讓 sub-checker 真的不擋
      const res = await fetch('/api/notification-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: targetSourceId,
          quietStart: quietEnabled ? quietStart : null,
          quietEnd: quietEnabled ? quietEnd : null,
          dailySummary,
          priceAlerts
        })
      });

      const data = await res.json();
      if (data.ok) {
        setSavedMsg('設定已保存');
        setTimeout(() => setSavedMsg(null), 3000);
      } else {
        setError(data.error || '保存失敗');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (!liffReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  const isGroupContext = !!groupCtxId && (groupCtxId.startsWith('C') || groupCtxId.startsWith('R'));

  return (
    <>
      <TabNav active="settings" liffId={liffId} />
      <div className="settings-wrap">
        <header className="settings-header">
          <div className="header-content">
            <h1>⚙️ 通知設定</h1>
            {isGroupContext && <Badge variant="info">群組設定</Badge>}
          </div>
          <div className="flight-indicator">
            <div className="indicator-label">飛行狀態</div>
            <div className="altitude-display">ON</div>
          </div>
        </header>

        {error && <Alert type="error" closable onClose={() => setError(null)}>{error}</Alert>}
        {savedMsg && <Alert type="success" closable onClose={() => setSavedMsg(null)}>{savedMsg}</Alert>}

        <Card>
          <h2 className="setting-title">🔔 價格提醒</h2>

          <div className="setting-item">
            <div className="setting-label">
              <label htmlFor="price-alerts">啟用降價通知</label>
              <p className="setting-hint">當航班價格下跌時收到通知</p>
            </div>
            <input
              id="price-alerts"
              type="checkbox"
              checked={priceAlerts}
              onChange={e => setPriceAlerts(e.target.checked)}
              className="toggle"
              aria-label="Enable price alerts"
            />
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <label htmlFor="daily-summary">每日摘要</label>
              <p className="setting-hint">早上 8 點收到當天的最低價格</p>
            </div>
            <input
              id="daily-summary"
              type="checkbox"
              checked={dailySummary}
              onChange={e => setDailySummary(e.target.checked)}
              className="toggle"
              aria-label="Enable daily summary"
            />
          </div>
        </Card>

        <Card>
          <h2 className="setting-title">🤐 靜音時段</h2>

          <div className="setting-item">
            <div className="setting-label">
              <label htmlFor="quiet-enabled">啟用靜音時段</label>
              <p className="setting-hint">在指定時間不會收到通知</p>
            </div>
            <input
              id="quiet-enabled"
              type="checkbox"
              checked={quietEnabled}
              onChange={e => setQuietEnabled(e.target.checked)}
              className="toggle"
              aria-label="Enable quiet hours"
            />
          </div>

          {quietEnabled && (
            <div className="time-range">
              <div className="time-input-group">
                <label htmlFor="quiet-start">開始時間</label>
                <input
                  id="quiet-start"
                  type="time"
                  value={quietStart}
                  onChange={e => setQuietStart(e.target.value)}
                  className="time-input"
                  aria-label="Quiet period start time"
                />
              </div>

              <div className="time-input-group">
                <label htmlFor="quiet-end">結束時間</label>
                <input
                  id="quiet-end"
                  type="time"
                  value={quietEnd}
                  onChange={e => setQuietEnd(e.target.value)}
                  className="time-input"
                  aria-label="Quiet period end time"
                />
              </div>
            </div>
          )}
        </Card>

        <div className="button-group">
          <Button
            onClick={handleSave}
            disabled={saving}
            size="lg"
            fullWidth
          >
            {saving ? '💾 保存中…' : '✓ 保存設定'}
          </Button>
        </div>

        <style jsx>{`
          .settings-wrap {
            max-width: 600px;
            margin: 0 auto;
            padding: 16px;
            padding-bottom: 80px;
            background: linear-gradient(180deg, #f8f9fa 0%, #ffffff 100%);
            min-height: 100vh;
          }

          .settings-header {
            margin-bottom: 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
            background: linear-gradient(135deg, #001a4d 0%, #1a3a66 100%);
            border-radius: 16px;
            padding: 28px;
            border: 1px solid rgba(0, 102, 255, 0.3);
            box-shadow: 0 8px 32px rgba(0, 102, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          }

          .header-content {
            flex: 1;
          }

          .settings-header h1 {
            font-size: 28px;
            font-weight: 800;
            margin: 0;
            color: #ffffff;
            letter-spacing: -0.5px;
          }

          .flight-indicator {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            backdrop-filter: blur(10px);
          }

          .indicator-label {
            font-size: 11px;
            color: #a0c4ff;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .altitude-display {
            font-size: 16px;
            font-weight: 800;
            color: #4ade80;
            font-family: 'Courier New', monospace;
            text-shadow: 0 0 10px rgba(74, 222, 128, 0.5);
          }

          .setting-title {
            font-size: 18px;
            font-weight: 700;
            margin: 0 0 20px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: #1f2937;
          }

          .setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 0;
            border-bottom: 1px solid #e0e7ff;
            transition: all 0.2s ease;
          }

          .setting-item:hover {
            padding-left: 8px;
            padding-right: 8px;
          }

          .setting-item:last-child {
            border-bottom: none;
          }

          .setting-label {
            flex: 1;
          }

          .setting-label label {
            display: block;
            font-weight: 500;
            margin-bottom: 4px;
            cursor: pointer;
          }

          .setting-hint {
            font-size: 13px;
            color: #6b7280;
            margin: 0;
          }

          .toggle {
            width: 52px;
            height: 32px;
            -webkit-appearance: none;
            appearance: none;
            background: linear-gradient(135deg, #e0e7ff 0%, #d9e3ff 100%);
            border: 1.5px solid #c7d5ff;
            border-radius: 999px;
            cursor: pointer;
            position: relative;
            transition: all 0.3s ease;
            flex-shrink: 0;
            box-shadow: 0 2px 4px rgba(0, 102, 255, 0.1);
          }

          .toggle:checked {
            background: linear-gradient(135deg, #0066ff 0%, #0052cc 100%);
            border-color: #0052cc;
            box-shadow: 0 4px 12px rgba(0, 102, 255, 0.3);
          }

          .toggle:before {
            content: '';
            position: absolute;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: white;
            top: 3px;
            left: 3px;
            transition: left 0.3s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }

          .toggle:checked:before {
            left: 23px;
          }

          .time-range {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-top: 12px;
            padding: 16px;
            background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%);
            border: 1px solid #e0e7ff;
            border-radius: 10px;
            box-shadow: 0 2px 8px rgba(0, 102, 255, 0.06);
          }

          .time-input-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .time-input-group label {
            font-size: 12px;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .time-input {
            padding: 10px 12px;
            border: 1.5px solid #e0e7ff;
            border-radius: 8px;
            font-size: 14px;
            background: white;
            transition: all 0.2s ease;
            font-family: inherit;
          }

          .time-input:focus {
            outline: none;
            border-color: #0066ff;
            background: white;
            box-shadow: 0 0 0 3px rgba(0, 102, 255, 0.1), 0 2px 8px rgba(0, 102, 255, 0.15);
          }

          .button-group {
            margin-top: 28px;
            display: flex;
            gap: 12px;
          }

          @media (max-width: 640px) {
            .settings-wrap {
              padding: 12px;
            }

            .settings-header {
              flex-direction: column;
              align-items: flex-start;
            }

            .time-range {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </div>
    </>
  );
}
