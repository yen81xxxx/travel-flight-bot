/**
 * 加載指示器組件
 */

import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}

export function Spinner({ size = 'md', color = '#0066ff' }: SpinnerProps) {
  const sizeClass = {
    sm: 'spinner-sm',
    md: 'spinner-md',
    lg: 'spinner-lg'
  }[size];

  return (
    <div className={`spinner ${sizeClass}`} style={{ borderTopColor: color }} role="status">
      <span className="sr-only">Loading...</span>
      <style jsx>{`
        .spinner {
          border: 3px solid rgba(0, 0, 0, 0.1);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        .spinner-sm {
          width: 20px;
          height: 20px;
          border-width: 2px;
        }

        .spinner-md {
          width: 40px;
          height: 40px;
          border-width: 3px;
        }

        .spinner-lg {
          width: 60px;
          height: 60px;
          border-width: 4px;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border-width: 0;
        }
      `}</style>
    </div>
  );
}
