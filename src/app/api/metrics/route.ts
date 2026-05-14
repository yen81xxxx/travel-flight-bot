import { NextRequest, NextResponse } from 'next/server';

/**
 * Performance metrics collection endpoint
 * Receives performance data from client and stores for analysis
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate metrics payload
    const { fcp, lcp, fid, cls, tbt, tti } = body;
    if (typeof fcp !== 'number' || typeof lcp !== 'number') {
      return NextResponse.json(
        { error: 'Invalid metrics payload' },
        { status: 400 }
      );
    }

    // In production, you would:
    // 1. Store metrics in a database (e.g., InfluxDB, CloudWatch, DataDog)
    // 2. Track performance trends
    // 3. Set up alerts for performance degradation
    // 4. Create dashboards with the data

    // For now, just log to console and return success
    console.log('[Performance Metrics]', {
      timestamp: new Date().toISOString(),
      fcp: `${fcp.toFixed(2)}ms`,
      lcp: `${lcp.toFixed(2)}ms`,
      fid: `${fid.toFixed(2)}ms`,
      cls: `${cls.toFixed(4)}`,
      tbt: `${tbt.toFixed(2)}ms`,
      tti: `${tti.toFixed(2)}ms`,
      userAgent: request.headers.get('user-agent')
    });

    return NextResponse.json({
      ok: true,
      message: 'Metrics recorded successfully'
    });
  } catch (error) {
    console.error('[Metrics API Error]', error);
    return NextResponse.json(
      { error: 'Failed to process metrics' },
      { status: 500 }
    );
  }
}
