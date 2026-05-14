/**
 * 警告/通知組件
 */

import React from 'react';

type AlertType = 'info' | 'success' | 'warning' | 'error';

interface AlertProps {
  type: AlertType;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  closable?: boolean;
}

export function Alert({ type, title, children, onClose, closable = true }: AlertProps) {
  const [isVisible, setIsVisible] = React.useState(true);

  if (!isVisible) return null;

  const typeClass = {
    info: 'alert-info',
    success: 'alert-success',
    warning: 'alert-warning',
    error: 'alert-error'
  }[type];

  const icon = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌'
  }[type];

  const handleClose = () => {
    setIsVisible(false);
    onClose?.();
  };

  return (
    <div className={`alert ${typeClass}`} role="alert">
      <div className="alert-content">
        <div className="alert-icon">{icon}</div>
        <div className="alert-text">
          {title && <h4 className="alert-title">{title}</h4>}
          <p className="alert-message">{children}</p>
        </div>
      </div>
      {closable && (
        <button
          className="alert-close"
          onClick={handleClose}
          aria-label="Close alert"
        >
          ✕
        </button>
      )}

      <style jsx>{`
        .alert {
          padding: 12px 16px;
          border-radius: 8px;
          display: flex;
          gap: 12px;
          align-items: flex-start;
          margin-bottom: 12px;
        }

        .alert-content {
          flex: 1;
          display: flex;
          gap: 10px;
        }

        .alert-icon {
          font-size: 18px;
          flex-shrink: 0;
        }

        .alert-text {
          flex: 1;
        }

        .alert-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 4px;
        }

        .alert-message {
          font-size: 13px;
          margin: 0;
          line-height: 1.5;
        }

        .alert-close {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          padding: 0;
          color: inherit;
          opacity: 0.7;
          transition: opacity 0.2s;
          flex-shrink: 0;
        }

        .alert-close:hover {
          opacity: 1;
        }

        .alert-info {
          background: #e0f2fe;
          color: #0077b6;
          border: 1px solid #bae6fd;
        }

        .alert-success {
          background: #dcfce7;
          color: #166534;
          border: 1px solid #bbf7d0;
        }

        .alert-warning {
          background: #fef3c7;
          color: #92400e;
          border: 1px solid #fcd34d;
        }

        .alert-error {
          background: #fee2e2;
          color: #991b1b;
          border: 1px solid #fca5a5;
        }

        @media (max-width: 640px) {
          .alert {
            padding: 10px 12px;
            gap: 8px;
          }

          .alert-icon {
            font-size: 16px;
          }

          .alert-message {
            font-size: 12px;
          }
        }
      `}</style>
    </div>
  );
}
