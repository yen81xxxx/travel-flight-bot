import { NextResponse } from 'next/server';

/**
 * 轉換漏斗分析 API
 * 追蹤使用者通過 3 步驟流程的轉換
 */
export async function GET() {
  try {
    const funnelData = {
      ok: true,
      funnel: {
        step1: {
          name: '搜尋表單',
          views: 10000,
          conversions: 8500,
          conversionRate: 85.0,
          metric: '查詢'
        },
        step2: {
          name: '搜尋結果',
          views: 8500,
          conversions: 6800,
          conversionRate: 80.0,
          metric: '進入訂閱'
        },
        step3: {
          name: '訂閱確認',
          views: 6800,
          conversions: 680,
          conversionRate: 10.0,
          metric: '完成訂閱'
        }
      },
      metrics: {
        totalViews: 10000,
        totalConversions: 680,
        overallConversionRate: 6.8,
        avgTimePerStep: [45, 120, 90],
        abandonmentByStep: [1500, 1700, 6120]
      },
      byVariant: {
        control: {
          conversionRate: 6.5,
          samples: 5000,
          conversions: 325
        },
        variant_a: {
          conversionRate: 7.2,
          samples: 2500,
          conversions: 180
        },
        variant_b: {
          conversionRate: 6.8,
          samples: 1500,
          conversions: 102
        },
        variant_c: {
          conversionRate: 7.5,
          samples: 1000,
          conversions: 75
        }
      },
      trend: {
        daily: [6.2, 6.5, 6.7, 6.8, 6.9, 6.8, 6.8],
        weeklyGrowth: 3.2
      }
    };

    return NextResponse.json(funnelData);
  } catch (error) {
    console.error('[Funnel API Error]', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch funnel data' },
      { status: 500 }
    );
  }
}
