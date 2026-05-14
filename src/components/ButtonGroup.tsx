import React, { ReactNode } from 'react';

interface ButtonGroupProps {
  direction?: 'horizontal' | 'vertical';
  gap?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Button group for organizing multiple buttons
 * Provides consistent spacing and layout
 */
export const ButtonGroupComponent = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ direction = 'horizontal', gap = 'md', fullWidth = false, children, className }, ref) => {
    const gapSize = {
      sm: '8px',
      md: '12px',
      lg: '16px'
    }[gap];

    return (
      <div
        ref={ref}
        className={`button-group ${className || ''}`}
        style={{
          display: 'flex',
          flexDirection: direction === 'vertical' ? 'column' : 'row',
          gap: gapSize,
          width: fullWidth ? '100%' : 'auto'
        }}
      >
        {React.Children.map(children, (child) => (
          <div style={{ flex: fullWidth ? 1 : undefined }}>
            {child}
          </div>
        ))}
      </div>
    );
  }
);

ButtonGroupComponent.displayName = 'ButtonGroup';
