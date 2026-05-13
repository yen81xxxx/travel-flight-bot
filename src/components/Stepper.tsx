/**
 * 進度指示器組件 - 用於多步流程
 */

import React from 'react';

interface StepperProps {
  steps: string[];
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function Stepper({ steps, currentStep, onStepClick }: StepperProps) {
  return (
    <div className="stepper">
      <div className="steps-container">
        {steps.map((label, index) => (
          <React.Fragment key={index}>
            <div
              className={`step ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
              onClick={() => onStepClick?.(index)}
              role="button"
              tabIndex={0}
              title={label}
            >
              <div className="step-number">
                {index < currentStep ? (
                  <span className="checkmark">✓</span>
                ) : (
                  <span>{index + 1}</span>
                )}
              </div>
              <span className="step-label">{label}</span>
            </div>
            {index < steps.length - 1 && (
              <div className={`step-connector ${index < currentStep ? 'completed' : ''}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      <style jsx>{`
        .stepper {
          width: 100%;
          margin-bottom: 32px;
        }

        .steps-container {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .step {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          position: relative;
          flex: 1;
          text-align: center;
        }

        .step-number {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 16px;
          background: #e5e7eb;
          color: #6b7280;
          border: 2px solid transparent;
          transition: all 0.2s;
        }

        .step.active .step-number {
          background: #0066ff;
          color: white;
          border-color: #0066ff;
          box-shadow: 0 0 0 3px rgba(0, 102, 255, 0.1);
        }

        .step.completed .step-number {
          background: #28a745;
          color: white;
          border-color: #28a745;
        }

        .checkmark {
          display: inline-block;
          font-size: 20px;
          line-height: 1;
        }

        .step-label {
          font-size: 12px;
          font-weight: 500;
          color: #6b7280;
          max-width: 80px;
          word-break: break-word;
        }

        .step.active .step-label {
          color: #0066ff;
          font-weight: 600;
        }

        .step.completed .step-label {
          color: #28a745;
        }

        .step-connector {
          height: 2px;
          background: #e5e7eb;
          flex: 1;
          margin: 0 4px;
          transition: background 0.2s;
        }

        .step-connector.completed {
          background: #28a745;
        }

        /* 行動版適配 */
        @media (max-width: 640px) {
          .steps-container {
            gap: 4px;
          }

          .step-number {
            width: 32px;
            height: 32px;
            font-size: 14px;
          }

          .step-label {
            font-size: 11px;
            max-width: 60px;
          }

          .step-connector {
            margin: 0 2px;
          }
        }
      `}</style>
    </div>
  );
}
