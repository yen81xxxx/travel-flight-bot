'use client';

import { useEffect, useState } from 'react';
import { PagePerformance } from './page-performance';
import { ABTestResults } from './ab-test-results';
import { PerformanceAlerts } from './performance-alerts';

interface PerformanceMetrics {
  fcp: { value: number; status: string; history: number[] };
  lcp: { value: number; status: string; history: number[] };
  fid: { value: number; status: string; history: number[] };
  cls: { value: number; status: string; history: number[] };
  tbt: { value: number; status: string; history: number[] };
  tti: { value: number; status: string; history: number[] };
}

interface FunnelData {
  step1: { views: number; conversions: number; conversionRate: number };
  step2: { views: number; conversions: number; conversionRate: number };
  step3: { views: number; conversions: number; conversionRate: number };
}

interface PagePerf {
  page: string;
  lcp: number;
  fcp: number;
  samples: number;
}

interface VariantMetrics {
  [key: string]: {
    conversionRate: number;
    samples: number;
    conversions: number;
  };
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [pagePerf, setPagePerf] = useState<PagePerf[] | null>(null);
  const [variants, setVariants] = useState<VariantMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [perfRes, funnelRes] = await Promise.all([
          fetch('/api/admin/performance'),
          fetch('/api/admin/funnel')
        ]);

        if (!perfRes.ok || !funnelRes.ok) throw new Error('API Error');

        const perfData = await perfRes.json();
        const funnelData = await funnelRes.json();

        setMetrics(perfData.metrics);
        setFunnel(funnelData.funnel);
        setPagePerf(perfData.pagePerformance);
        setVariants(funnelData.byVariant);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);


  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner"></div>
        <p>載入儀表板中…</p>
        <style jsx>{`
          .dashboard-loading {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(0, 0, 0, 0.1);
            border-top-color: #0066ff;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>📊 管理員儀表板</h1>
        <p>性能和轉換指標監控</p>
      </header>

      {error && <div className="error-banner">⚠️ {error}</div>}

      {/* 性能警報 */}
      {metrics && (
        <section className="section">
          <h2>🚨 性能警報</h2>
          <PerformanceAlerts metrics={metrics as unknown as Record<string, { value: number; threshold: number; status: string }> } />
        </section>
      )}

      {/* Core Web Vitals */}
      <section className="section">
        <h2>⚡ Core Web Vitals</h2>
        <div className="metrics-grid">
          {metrics && (
            <>
              <MetricCard
                label="FCP"
                value={metrics.fcp.value}
                unit="ms"
                status={metrics.fcp.status}
                threshold={1800}
              />
              <MetricCard
                label="LCP"
                value={metrics.lcp.value}
                unit="ms"
                status={metrics.lcp.status}
                threshold={2500}
              />
              <MetricCard
                label="FID"
                value={metrics.fid.value}
                unit="ms"
                status={metrics.fid.status}
                threshold={100}
              />
              <MetricCard
                label="CLS"
                value={metrics.cls.value}
                unit=""
                status={metrics.cls.status}
                threshold={0.1}
              />
              <MetricCard
                label="TBT"
                value={metrics.tbt.value}
                unit="ms"
                status={metrics.tbt.status}
                threshold={200}
              />
              <MetricCard
                label="TTI"
                value={metrics.tti.value}
                unit="ms"
                status={metrics.tti.status}
                threshold={3800}
              />
            </>
          )}
        </div>
      </section>

      {/* 轉換漏斗 */}
      <section className="section">
        <h2>🔀 轉換漏斗分析</h2>
        {funnel && (
          <div className="funnel-container">
            <FunnelStep
              step={1}
              name={funnel.step1.views > 0 ? '搜尋表單' : ''}
              views={funnel.step1.views}
              conversions={funnel.step1.conversions}
              conversionRate={funnel.step1.conversionRate}
              width={100}
            />
            <FunnelStep
              step={2}
              name={funnel.step2.views > 0 ? '搜尋結果' : ''}
              views={funnel.step2.views}
              conversions={funnel.step2.conversions}
              conversionRate={funnel.step2.conversionRate}
              width={(funnel.step2.views / funnel.step1.views) * 100}
            />
            <FunnelStep
              step={3}
              name={funnel.step3.views > 0 ? '訂閱確認' : ''}
              views={funnel.step3.views}
              conversions={funnel.step3.conversions}
              conversionRate={funnel.step3.conversionRate}
              width={(funnel.step3.views / funnel.step1.views) * 100}
            />
          </div>
        )}
      </section>

      {/* 頁面性能 */}
      {pagePerf && <PagePerformance pages={pagePerf} />}

      {/* A/B 測試結果 */}
      {variants && <ABTestResults variants={variants} />}

      <style jsx>{`
        .dashboard {
          max-width: 1200px;
          margin: 0 auto;
          padding: 24px;
          background: linear-gradient(180deg, #f8f9fa 0%, #ffffff 100%);
          min-height: 100vh;
        }

        .dashboard-header {
          margin-bottom: 32px;
          text-align: center;
        }

        .dashboard-header h1 {
          font-size: 32px;
          font-weight: 800;
          margin: 0 0 8px 0;
          color: #0f172a;
        }

        .dashboard-header p {
          font-size: 16px;
          color: #6b7280;
          margin: 0;
        }

        .section {
          background: white;
          border-radius: 14px;
          padding: 28px;
          margin-bottom: 24px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
          border: 1px solid #e0e7ff;
        }

        .section h2 {
          font-size: 20px;
          font-weight: 700;
          margin: 0 0 20px 0;
          color: #1f2937;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 16px;
        }

        .funnel-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .error-banner {
          background: #fee2e2;
          color: #991b1b;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 16px;
          border: 1px solid #fca5a5;
        }

        @media (max-width: 768px) {
          .dashboard {
            padding: 16px;
          }

          .section {
            padding: 16px;
          }

          .metrics-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  status,
  threshold
}: {
  label: string;
  value: number;
  unit: string;
  status: string;
  threshold: number;
}) {
  const isGood = status === 'good';
  const statusColor = isGood ? '#22c55e' : status === 'need-improvement' ? '#f59e0b' : '#ef4444';

  return (
    <div className="metric-card">
      <div className="metric-header">
        <span className="metric-label">{label}</span>
        <span className="metric-status" style={{ color: statusColor }}>
          {isGood ? '✓' : '!'}
        </span>
      </div>
      <div className="metric-value">
        {value}
        <span className="unit">{unit}</span>
      </div>
      <div className="metric-threshold">
        目標: {threshold}
        {unit}
      </div>
      <style jsx>{`
        .metric-card {
          padding: 16px;
          background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%);
          border: 1px solid #e0e7ff;
          border-radius: 10px;
          border-left: 4px solid ${statusColor};
        }

        .metric-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .metric-label {
          font-size: 12px;
          font-weight: 700;
          color: #6b7280;
          text-transform: uppercase;
        }

        .metric-status {
          font-size: 16px;
          font-weight: bold;
        }

        .metric-value {
          font-size: 24px;
          font-weight: 800;
          color: #1f2937;
          margin-bottom: 4px;
        }

        .unit {
          font-size: 14px;
          color: #9ca3af;
          margin-left: 2px;
        }

        .metric-threshold {
          font-size: 11px;
          color: #9ca3af;
        }
      `}</style>
    </div>
  );
}

function FunnelStep({
  step,
  name,
  views,
  conversions,
  conversionRate,
  width
}: {
  step: number;
  name: string;
  views: number;
  conversions: number;
  conversionRate: number;
  width: number;
}) {
  return (
    <div className="funnel-step">
      <div className="funnel-bar" style={{ width: `${width}%` }}>
        <div className="funnel-content">
          <span className="step-number">Step {step}</span>
          <span className="step-name">{name}</span>
        </div>
        <div className="funnel-stats">
          <span>{views.toLocaleString()} 次</span>
          <span className="conversion">{conversionRate.toFixed(1)}%</span>
        </div>
      </div>
      <div className="funnel-info">
        {conversions.toLocaleString()} 轉換 / {views.toLocaleString()} 次
      </div>
      <style jsx>{`
        .funnel-step {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .funnel-bar {
          background: linear-gradient(90deg, #0066ff 0%, #0052cc 100%);
          color: white;
          padding: 16px;
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          min-height: 60px;
          box-shadow: 0 2px 8px rgba(0, 102, 255, 0.2);
        }

        .funnel-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .step-number {
          font-size: 12px;
          font-weight: 700;
          opacity: 0.8;
        }

        .step-name {
          font-size: 16px;
          font-weight: 600;
        }

        .funnel-stats {
          display: flex;
          gap: 16px;
          font-size: 14px;
          font-weight: 600;
        }

        .conversion {
          background: rgba(255, 255, 255, 0.2);
          padding: 4px 12px;
          border-radius: 20px;
        }

        .funnel-info {
          font-size: 12px;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
}
