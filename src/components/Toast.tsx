/**
 * Toast 通知組件 - 錯誤、成功、警告提示
 */

import { useEffect } from 'react';

interface ToastProps {
  type: 'error' | 'success' | 'warning' | 'info';
  message: string;
  onClose?: () => void;
  autoClose?: number; // ms
}

export function Toast({ type, message, onClose, autoClose = 5000 }: ToastProps) {
  // 自動關閉 Toast
  useEffect(() => {
    if (!autoClose || !onClose) return;
    const timer = setTimeout(onClose, autoClose);
    return () => clearTimeout(timer);
  }, [autoClose, onClose]);
  const bgColor = {
    error: 'bg-red-50 border-red-200',
    success: 'bg-green-50 border-green-200',
    warning: 'bg-yellow-50 border-yellow-200',
    info: 'bg-blue-50 border-blue-200'
  }[type];

  const textColor = {
    error: 'text-red-700',
    success: 'text-green-700',
    warning: 'text-yellow-700',
    info: 'text-blue-700'
  }[type];

  const icon = {
    error: '❌',
    success: '✅',
    warning: '⚠️',
    info: 'ℹ️'
  }[type];

  return (
    <div className={`flex items-center gap-3 p-4 border rounded-lg ${bgColor} ${textColor}`}>
      <span className="text-xl">{icon}</span>
      <p className="flex-1">{message}</p>
      {onClose && (
        <button
          onClick={onClose}
          className="text-2xl leading-none hover:opacity-70"
          aria-label="Close"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Error Alert - 錯誤提示
 */
interface ErrorAlertProps {
  title?: string;
  message: string;
  onDismiss?: () => void;
}

export function ErrorAlert({ title = 'Error', message, onDismiss }: ErrorAlertProps) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="flex gap-3">
        <div className="text-2xl">❌</div>
        <div className="flex-1">
          {title && <h3 className="font-bold text-red-900">{title}</h3>}
          <p className="text-red-700 text-sm mt-1">{message}</p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-red-500 hover:text-red-700 text-2xl leading-none"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Success Message - 成功訊息
 */
interface SuccessProps {
  message: string;
  onClose?: () => void;
}

export function Success({ message, onClose }: SuccessProps) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
      <span className="text-2xl">✅</span>
      <p className="text-green-700 flex-1">{message}</p>
      {onClose && (
        <button onClick={onClose} className="text-green-500 text-2xl leading-none">
          ×
        </button>
      )}
    </div>
  );
}
