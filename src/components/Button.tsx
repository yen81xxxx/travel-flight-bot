/**
 * 按鈕組件 - 專業級設計
 * 支持多種變體、尺寸、狀態、無障礙功能
 */

import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-blue-600 text-white
    hover:bg-blue-700 active:bg-blue-800
    disabled:bg-gray-300 disabled:text-gray-500
  `,
  secondary: `
    bg-gray-100 text-gray-900
    hover:bg-gray-200 active:bg-gray-300
    border border-gray-300
    disabled:bg-gray-50 disabled:text-gray-400
  `,
  danger: `
    bg-red-600 text-white
    hover:bg-red-700 active:bg-red-800
    disabled:bg-gray-300
  `,
  success: `
    bg-green-600 text-white
    hover:bg-green-700 active:bg-green-800
    disabled:bg-gray-300
  `,
  ghost: `
    bg-transparent text-blue-600
    hover:bg-blue-50 active:bg-blue-100
    disabled:text-gray-400
  `
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: `px-3 py-1.5 text-sm font-medium rounded-md min-h-8`,
  md: `px-4 py-2.5 text-base font-medium rounded-lg min-h-10`,
  lg: `px-6 py-3 text-lg font-semibold rounded-lg min-h-12`
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled = false,
      fullWidth = false,
      icon,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`
          inline-flex items-center justify-center gap-2
          font-medium rounded-lg
          transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
          disabled:cursor-not-allowed disabled:opacity-60
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `}
        aria-busy={loading}
        aria-disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {icon && !loading && <span className="flex-shrink-0">{icon}</span>}
        <span>{children}</span>
      </button>
    );
  }
);

Button.displayName = 'Button';

/**
 * 按鈕組 - 水平排列多個按鈕
 */
interface ButtonGroupProps {
  children: React.ReactNode;
  vertical?: boolean;
}

export function ButtonGroup({ children, vertical = false }: ButtonGroupProps) {
  return (
    <div className={`flex gap-2 ${vertical ? 'flex-col' : 'flex-row'}`}>
      {children}
    </div>
  );
}
