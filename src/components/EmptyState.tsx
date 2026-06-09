/**
 * 空狀態組件 - 無數據提示
 */

import React from 'react';

interface EmptyStateProps {
  /** Icon element (e.g. <Icon name="bookmark" size={64} />). String fallback allowed for legacy callers. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3 className="empty-title">{title}</h3>
      {description && <p className="empty-description">{description}</p>}
      {action && (
        <button onClick={action.onClick} className="empty-action">
          {action.label}
        </button>
      )}

      <style jsx>{`
        .empty-state {
          text-align: center;
          padding: 48px 32px;
          color: #6b7280;
        }

        .empty-icon {
          font-size: 64px;
          margin-bottom: 16px;
          display: block;
        }

        .empty-title {
          font-size: 18px;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 8px;
        }

        .empty-description {
          font-size: 14px;
          color: #6b7280;
          margin: 0 0 24px;
          line-height: 1.5;
        }

        .empty-action {
          padding: 10px 20px;
          background: #0066ff;
          color: white;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }

        .empty-action:hover {
          background: #0052cc;
        }

        @media (max-width: 640px) {
          .empty-state {
            padding: 32px 16px;
          }

          .empty-icon {
            font-size: 48px;
          }

          .empty-title {
            font-size: 16px;
          }
        }
      `}</style>
    </div>
  );
}
