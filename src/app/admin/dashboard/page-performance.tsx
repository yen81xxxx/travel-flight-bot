'use client';

interface PagePerformanceProps {
  pages: Array<{
    page: string;
    lcp: number;
    fcp: number;
    samples: number;
  }>;
}

export function PagePerformance({ pages }: PagePerformanceProps) {
  return (
    <section className="section">
      <h2>📄 頁面性能</h2>
      <div className="pages-table">
        <div className="table-header">
          <div>頁面</div>
          <div>LCP (ms)</div>
          <div>FCP (ms)</div>
          <div>樣本數</div>
        </div>
        {pages.map((page, idx) => (
          <div key={idx} className="table-row">
            <div className="page-name">{page.page}</div>
            <div className={`metric ${page.lcp > 2500 ? 'poor' : page.lcp > 1800 ? 'warn' : 'good'}`}>
              {page.lcp}
            </div>
            <div className={`metric ${page.fcp > 1800 ? 'poor' : page.fcp > 1200 ? 'warn' : 'good'}`}>
              {page.fcp}
            </div>
            <div className="samples">{page.samples.toLocaleString()}</div>
          </div>
        ))}
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
          margin: 0 0 16px 0;
          color: #1f2937;
        }

        .pages-table {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          overflow: hidden;
        }

        .table-header {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 16px;
          padding: 12px 16px;
          background: #f9f9f9;
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
          color: #6b7280;
          border-bottom: 1px solid #e5e7eb;
        }

        .table-row {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 16px;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          align-items: center;
        }

        .page-name {
          font-weight: 600;
          color: #1f2937;
          font-size: 13px;
        }

        .metric {
          font-weight: 700;
          font-size: 13px;
        }

        .metric.good {
          color: #22c55e;
        }

        .metric.warn {
          color: #f59e0b;
        }

        .metric.poor {
          color: #ef4444;
        }

        .samples {
          color: #9ca3af;
          font-size: 12px;
        }
      `}</style>
    </section>
  );
}
