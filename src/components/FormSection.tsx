import React, { ReactNode } from 'react';

interface FormSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Form section for grouping related fields
 * Provides visual separation and clear hierarchy
 */
export const FormSection = React.forwardRef<HTMLDivElement, FormSectionProps>(
  ({ title, description, children, className }, ref) => {
    return (
      <section ref={ref} className={`form-section ${className || ''}`}>
        {title && (
          <div className="form-section-header">
            <h3 className="form-section-title">{title}</h3>
            {description && (
              <p className="form-section-description">{description}</p>
            )}
          </div>
        )}

        <div className="form-section-content">{children}</div>

        <style jsx>{`
          .form-section {
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 20px 16px;
            border-radius: 12px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
          }

          .form-section-header {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .form-section-title {
            font-size: 16px;
            font-weight: 600;
            color: #1f2937;
            margin: 0;
          }

          .form-section-description {
            font-size: 13px;
            color: #6b7280;
            margin: 0;
          }

          .form-section-content {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          @media (max-width: 640px) {
            .form-section {
              padding: 16px 12px;
              gap: 12px;
            }
          }
        `}</style>
      </section>
    );
  }
);

FormSection.displayName = 'FormSection';
