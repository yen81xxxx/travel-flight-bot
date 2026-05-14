'use client';

interface VariantMetrics {
  [key: string]: {
    conversionRate: number;
    samples: number;
    conversions: number;
  };
}

interface ABTestResultsProps {
  variants: VariantMetrics;
}

export function ABTestResults({ variants }: ABTestResultsProps) {
  const entries = Object.entries(variants);
  const bestVariant = entries.reduce((best, [_, metrics]) =>
    metrics.conversionRate > best[1].conversionRate ? [_, metrics] : best
  ) as [string, (typeof variants)[keyof typeof variants]];

  return (
    <section className="section">
      <h2>🧪 A/B 測試結果</h2>
      <div className="variants-grid">
        {entries.map(([variant, metrics]) => {
          const isBest = variant === bestVariant[0];
          return (
            <div key={variant} className={`variant-card ${isBest ? 'best' : ''}`}>
              {isBest && <div className="best-badge">🏆 最佳</div>}
              <div className="variant-name">
                {variant === 'control' ? '對照組' : `變體 ${variant.split('_')[1]?.toUpperCase()}`}
              </div>
              <div className="conversion-rate">
                {metrics.conversionRate.toFixed(2)}%
              </div>
              <div className="metrics-detail">
                <div>{metrics.conversions} / {metrics.samples} 轉換</div>
              </div>
              {isBest && (
                <div className="improvement">
                  相對對照組 +{(
                    ((metrics.conversionRate - variants.control.conversionRate) /
                      variants.control.conversionRate) * 100
                  ).toFixed(1)}%
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style jsx>{`
        .section {
          background: white;
          border-radius: 14px;
          padding: 24px;
          margin-bottom: 24px;
          border: 1px solid #e0e7ff;
        }

        .section h2 {
          font-size: 18px;
          font-weight: 700;
          margin: 0 0 20px 0;
          color: #1f2937;
        }

        .variants-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }

        .variant-card {
          padding: 20px;
          border: 1.5px solid #e0e7ff;
          border-radius: 10px;
          background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%);
          transition: all 0.2s;
          position: relative;
        }

        .variant-card:hover {
          border-color: #b3c9ff;
          box-shadow: 0 4px 12px rgba(0, 102, 255, 0.1);
          transform: translateY(-2px);
        }

        .variant-card.best {
          border-color: #0066ff;
          background: linear-gradient(135deg, #f0f4ff 0%, #e8f0ff 100%);
          box-shadow: 0 4px 12px rgba(0, 102, 255, 0.15);
        }

        .best-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          background: #0066ff;
          color: white;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
        }

        .variant-name {
          font-size: 13px;
          color: #6b7280;
          font-weight: 600;
          text-transform: uppercase;
          margin-bottom: 12px;
        }

        .conversion-rate {
          font-size: 32px;
          font-weight: 800;
          color: #0066ff;
          margin-bottom: 8px;
        }

        .metrics-detail {
          font-size: 12px;
          color: #9ca3af;
          margin-bottom: 8px;
        }

        .improvement {
          font-size: 12px;
          color: #22c55e;
          font-weight: 700;
          padding: 8px;
          background: rgba(34, 197, 94, 0.1);
          border-radius: 6px;
          margin-top: 8px;
        }
      `}</style>
    </section>
  );
}
