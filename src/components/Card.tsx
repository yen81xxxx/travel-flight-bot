/**
 * 卡片組件 - 用於展示內容塊
 */

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  bordered?: boolean;
  shadow?: 'sm' | 'md' | 'lg' | 'none';
  hoverable?: boolean;
}

const shadowMap = {
  none: '',
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg'
};

export function Card({
  children,
  className = '',
  bordered = true,
  shadow = 'md',
  hoverable = false
}: CardProps) {
  return (
    <div
      className={`
        bg-white rounded-lg p-6
        ${bordered ? 'border border-gray-200' : ''}
        ${shadowMap[shadow]}
        ${hoverable ? 'transition-all duration-200 hover:shadow-lg hover:-translate-y-1 cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

/**
 * 卡片標題
 */
interface CardTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function CardTitle({ children, className = '' }: CardTitleProps) {
  return (
    <h3 className={`text-lg font-semibold text-gray-900 ${className}`}>
      {children}
    </h3>
  );
}

/**
 * 卡片描述
 */
interface CardDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function CardDescription({ children, className = '' }: CardDescriptionProps) {
  return (
    <p className={`text-sm text-gray-600 mt-2 ${className}`}>
      {children}
    </p>
  );
}

/**
 * 卡片內容
 */
interface CardContentProps {
  children: React.ReactNode;
  className?: string;
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return (
    <div className={`mt-4 ${className}`}>
      {children}
    </div>
  );
}

/**
 * 卡片頁腳
 */
interface CardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function CardFooter({ children, className = '' }: CardFooterProps) {
  return (
    <div className={`flex gap-2 mt-6 pt-6 border-t border-gray-200 ${className}`}>
      {children}
    </div>
  );
}

/**
 * 容器 - 中心對齐和最大寬度
 */
interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  full: 'max-w-full'
};

export function Container({ children, className = '', size = 'lg' }: ContainerProps) {
  return (
    <div className={`mx-auto px-4 sm:px-6 lg:px-8 ${sizeMap[size]} ${className}`}>
      {children}
    </div>
  );
}

/**
 * 柵欄 - 響應式網格
 */
interface GridProps {
  children: React.ReactNode;
  cols?: number;
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
}

const gapMap = {
  sm: 'gap-3',
  md: 'gap-4',
  lg: 'gap-6'
};

export function Grid({
  children,
  cols = 1,
  gap = 'md',
  className = ''
}: GridProps) {
  return (
    <div
      className={`
        grid
        ${cols >= 1 ? 'grid-cols-1' : ''}
        ${cols >= 2 ? 'sm:grid-cols-2' : ''}
        ${cols >= 3 ? 'md:grid-cols-3' : ''}
        ${cols >= 4 ? 'lg:grid-cols-4' : ''}
        ${gapMap[gap]}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
