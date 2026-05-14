'use client';

import { useEffect, useState } from 'react';

interface Alert {
  id: string;
  type: 'warning' | 'error' | 'info';
  metric: string;
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
}

interface PerformanceAlertsProps {
  metrics: Record<string, {
    value: number;
    threshold: number;
    status: string;
  }>;
}

export function PerformanceAlerts({ metrics }: PerformanceAlertsProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const newAlerts: Alert[] = [];

    Object.entries(metrics).forEach(([metric, data]) => {
      const { value, threshold, status } = data;

      if (status === 'poor') {
        newAlerts.push({
          id: `${metric}-${Date.now()}`,
          type: 'error',
          metric: metric.toUpperCase(),
          message: `${metric.toUpperCase()} 超過閾值`,
          value,
          threshold,
          timestamp: Date.now()
        });
      } else if (status === 'need-improvement') {
        newAlerts.push({
          id: `${metric}-${Date.now()}`,
          type: 'warning',
          metric: metric.toUpperCase(),
          message: `${metric.toUpperCase()} 需要改善`,
          value,
          threshold,
          timestamp: Date.now()
        });
      }
    });

    setAlerts(newAlerts);
  }, [metrics]);

  if (alerts.length === 0) {
    return (
      <div className="alerts-container">
        <div className="good-state">
          <span className="check-mark">✓</span>
          <div>
            <div className="good-title">所有指標正常</div>
            <div className="good-text">性能指標均達到目標</div>
          </div>
        </div>
        <style jsx>{`
          .alerts-container {
            padding: 20px;
          }

          .good-state {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 16px;
            background: linear-gradient(135deg, #f0fdf4 0%, #f0f4ff 100%);
            border: 1px solid #86efac;
            border-radius: 10px;
          }

          .check-mark {
            font-size: 28px;
            color: #22c55e;
          }

          .good-title {
            font-weight: 700;
            color: #166534;
          }

          .good-text {
            font-size: 13px;
            color: #4ade80;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="alerts-container">
      <div className="alerts-list">
        {alerts.map(alert => (
          <div key={alert.id} className={`alert alert-${alert.type}`}>
            <div className="alert-icon">
              {alert.type === 'error' && '✕'}
              {alert.type === 'warning' && '⚠'}
              {alert.type === 'info' && 'ⓘ'}
            </div>
            <div className="alert-content">
              <div className="alert-title">{alert.message}</div>
              <div className="alert-detail">
                目前: {alert.value.toFixed(2)} / 目標: {alert.threshold}
              </div>
            </div>
            <div className="alert-time">
              {new Date(alert.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .alerts-container {
          padding: 20px;
        }

        .alerts-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .alert {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-radius: 8px;
          border-left: 4px solid;
          animation: slideInDown 0.3s ease-out;
        }

        @keyframes slideInDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .alert-error {
          background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
          border-left-color: #ef4444;
          color: #991b1b;
        }

        .alert-warning {
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          border-left-color: #f59e0b;
          color: #92400e;
        }

        .alert-info {
          background: linear-gradient(135deg, #e0f4ff 0%, #bae6fd 100%);
          border-left-color: #0284c7;
          color: #0c4a6e;
        }

        .alert-icon {
          font-size: 18px;
          font-weight: bold;
          flex-shrink: 0;
        }

        .alert-content {
          flex: 1;
        }

        .alert-title {
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 2px;
        }

        .alert-detail {
          font-size: 12px;
          opacity: 0.8;
        }

        .alert-time {
          font-size: 11px;
          opacity: 0.6;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
