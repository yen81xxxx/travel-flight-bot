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

  // 群組上下文
  const [groupCtxId] = useSessionStorage<string | null>('liff_ctx', null);

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

    fetch(`/api/settings?sourceId=${encodeURIComponent(targetSourceId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.settings) {
          setQuietStart(data.settings.quietStart || '22:00');
          setQuietEnd(data.settings.quietEnd || '08:00');
          setQuietEnabled(data.settings.quietEnabled !== false);
          setDailySummary(data.settings.dailySummary !== false);
          setPriceAlerts(data.settings.priceAlerts !== false);
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
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: targetSourceId,
          quietStart,
          quietEnd,
          quietEnabled,
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
          <h1>⚙️ 通知設定</h1>
          {isGroupContext && <Badge variant="info">群組設定</Badge>}
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
          }

          .settings-header {
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .settings-header h1 {
            font-size: 28px;
            font-weight: 700;
            margin: 0;
          }

          .setting-title {
            font-size: 18px;
            font-weight: 600;
            margin: 0 0 16px;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 0;
            border-bottom: 1px solid #e5e7eb;
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
            width: 48px;
            height: 28px;
            -webkit-appearance: none;
            appearance: none;
            background: #d1d5db;
            border-radius: 999px;
            cursor: pointer;
            position: relative;
            transition: background 0.3s;
            flex-shrink: 0;
          }

          .toggle:checked {
            background: #0066ff;
          }

          .toggle:before {
            content: '';
            position: absolute;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: white;
            top: 2px;
            left: 2px;
            transition: left 0.3s;
          }

          .toggle:checked:before {
            left: 22px;
          }

          .time-range {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-top: 12px;
            padding: 12px;
            background: #f9f9f9;
            border-radius: 8px;
          }

          .time-input-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .time-input-group label {
            font-size: 13px;
            font-weight: 500;
            color: #6b7280;
          }

          .time-input {
            padding: 8px 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 14px;
          }

          .time-input:focus {
            outline: 2px solid #0066ff;
            outline-offset: -1px;
          }

          .button-group {
            margin-top: 24px;
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
