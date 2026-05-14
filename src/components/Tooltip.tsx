/**
 * 工具提示組件
 */

import React, { useState } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export function Tooltip({ content, children, position = 'top', delay = 200 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [timeoutId, setTimeoutId] = React.useState<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    const id = setTimeout(() => setIsVisible(true), delay);
    setTimeoutId(id);
  };

  const handleMouseLeave = () => {
    if (timeoutId) clearTimeout(timeoutId);
    setIsVisible(false);
  };

  const positionClass = {
    top: 'tooltip-top',
    bottom: 'tooltip-bottom',
    left: 'tooltip-left',
    right: 'tooltip-right'
  }[position];

  return (
    <div
      className={`tooltip-container ${positionClass}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isVisible && (
        <div className="tooltip-content" role="tooltip">
          {content}
        </div>
      )}

      <style jsx>{`
        .tooltip-container {
          position: relative;
          display: inline-block;
        }

        .tooltip-content {
          position: absolute;
          background: #1f2937;
          color: white;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          white-space: nowrap;
          z-index: 1000;
          animation: fadeIn 0.2s ease-out;
          pointer-events: none;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .tooltip-top .tooltip-content {
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-bottom: 8px;
        }

        .tooltip-bottom .tooltip-content {
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 8px;
        }

        .tooltip-left .tooltip-content {
          right: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-right: 8px;
        }

        .tooltip-right .tooltip-content {
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 8px;
        }
      `}</style>
    </div>
  );
}
