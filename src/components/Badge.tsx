/**
 * 徽章組件 - 標籤和狀態指示
 */

import React from 'react';

type BadgeVariant = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  rounded?: boolean;
}

export function Badge({ children, variant = 'primary', size = 'md', rounded = false }: BadgeProps) {
  const variantClass = {
    primary: 'badge-primary',
    success: 'badge-success',
    warning: 'badge-warning',
    error: 'badge-error',
    info: 'badge-info',
    neutral: 'badge-neutral'
  }[variant];

  const sizeClass = {
    sm: 'badge-sm',
    md: 'badge-md',
    lg: 'badge-lg'
  }[size];

  return (
    <span className={`badge ${variantClass} ${sizeClass} ${rounded ? 'badge-rounded' : ''}`}>
      {children}

      <style jsx>{`
        .badge {
          display: inline-flex;
          align-items: center;
          font-weight: 600;
          letter-spacing: 0.5px;
          border-radius: 4px;
          white-space: nowrap;
        }

        .badge-rounded {
          border-radius: 999px;
        }

        .badge-sm {
          padding: 2px 8px;
          font-size: 11px;
        }

        .badge-md {
          padding: 4px 12px;
          font-size: 12px;
        }

        .badge-lg {
          padding: 6px 14px;
          font-size: 13px;
        }

        .badge-primary {
          background: #dbeafe;
          color: #0066ff;
        }

        .badge-success {
          background: #dcfce7;
          color: #28a745;
        }

        .badge-warning {
          background: #fef3c7;
          color: #ff8c00;
        }

        .badge-error {
          background: #fee2e2;
          color: #ff2d55;
        }

        .badge-info {
          background: #e0f2fe;
          color: #0096d1;
        }

        .badge-neutral {
          background: #e5e7eb;
          color: #4b5563;
        }
      `}</style>
    </span>
  );
}
