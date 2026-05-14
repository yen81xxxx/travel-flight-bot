import React, { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  id: string;
  error?: string;
  required?: boolean;
  helperText?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Form field wrapper with label, error, and helper text
 * Provides consistent styling for form inputs
 */
export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ label, id, error, required, helperText, children, className }, ref) => {
    return (
      <div ref={ref} className={`form-field ${className || ''}`}>
        <label htmlFor={id} className="form-field-label">
          {label}
          {required && <span className="required">*</span>}
        </label>

        <div className="form-field-input">{children}</div>

        {error && <div className="form-field-error">{error}</div>}
        {!error && helperText && (
          <div className="form-field-helper">{helperText}</div>
        )}

        <style jsx>{`
          .form-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .form-field-label {
            font-size: 14px;
            font-weight: 500;
            color: #1f2937;
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .required {
            color: #ef4444;
            font-weight: bold;
          }

          .form-field-input {
            display: flex;
            width: 100%;
          }

          .form-field-error {
            font-size: 12px;
            color: #dc2626;
            font-weight: 500;
          }

          .form-field-helper {
            font-size: 12px;
            color: #6b7280;
            font-weight: 400;
          }
        `}</style>
      </div>
    );
  }
);

FormField.displayName = 'FormField';
