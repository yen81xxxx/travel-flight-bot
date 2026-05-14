import { NextResponse } from 'next/server';

/**
 * 性能指標 API
 * 返回 Core Web Vitals 和頁面性能數據
 */
export async function GET() {
  try {
    // 模擬性能數據 (實際應從 InfluxDB/DataDog 讀取)
    const performanceData = {
      ok: true,
      metrics: {
        fcp: {
          value: 1234,
          unit: 'ms',
          status: 'good',
          threshold: 1800,
          history: [1200, 1250, 1234, 1300, 1150]
        },
        lcp: {
          value: 1856,
          unit: 'ms',
          status: 'good',
          threshold: 2500,
          history: [1900, 1850, 1856, 1950, 1800]
        },
        fid: {
          value: 45,
          unit: 'ms',
          status: 'good',
          threshold: 100,
          history: [50, 45, 48, 42, 55]
        },
        cls: {
          value: 0.08,
          unit: '',
          status: 'good',
          threshold: 0.1,
          history: [0.09, 0.08, 0.08, 0.07, 0.10]
        },
        tbt: {
          value: 145,
          unit: 'ms',
          status: 'good',
          threshold: 200,
          history: [150, 145, 148, 140, 155]
        },
        tti: {
          value: 3200,
          unit: 'ms',
          status: 'good',
          threshold: 3800,
          history: [3300, 3200, 3250, 3100, 3400]
        }
      },
      pagePerformance: [
        { page: '/liff/search', lcp: 1856, fcp: 1234, samples: 1250 },
        { page: '/liff/settings', lcp: 1650, fcp: 1100, samples: 890 },
        { page: '/liff/subscriptions', lcp: 1520, fcp: 1050, samples: 756 }
      ],
      summary: {
        avgLCP: 1675,
        avgFCP: 1128,
        score: 94,
        trend: 'up' as const
      }
    };

    return NextResponse.json(performanceData);
  } catch (error) {
    console.error('[Performance API Error]', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch performance metrics' },
      { status: 500 }
    );
  }
}
