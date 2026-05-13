/**
 * 性能監測和優化工具
 */

interface PerformanceMetrics {
  functionName: string;
  duration: number; // ms
  timestamp: string;
  memory?: {
    heapUsed: number;
    external: number;
  };
}

const performanceLog: PerformanceMetrics[] = [];

/**
 * 性能監測裝飾器（高階函數包裝）
 */
export function withPerformanceTracking<T extends (...args: any[]) => Promise<unknown>>(
  fn: T,
  functionName?: string
): T {
  return (async (...args: any[]) => {
    const name = functionName || fn.name || 'anonymous';
    const startTime = performance.now();
    const startMemory = process.memoryUsage();

    try {
      return await fn(...args);
    } finally {
      const duration = performance.now() - startTime;
      const endMemory = process.memoryUsage();

      const metrics: PerformanceMetrics = {
        functionName: name,
        duration,
        timestamp: new Date().toISOString(),
        memory: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external
        }
      };

      performanceLog.push(metrics);
      if (duration > 1000) {
        console.warn(`[performance] ${name} took ${duration.toFixed(2)}ms (slow)`);
      }
    }
  }) as T;
}

/**
 * 同步函數性能監測
 */
export function measureSync<T>(
  fn: () => T,
  functionName = 'anonymous'
): T {
  const startTime = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - startTime;
    if (duration > 100) {
      console.warn(`[performance] ${functionName} took ${duration.toFixed(2)}ms (sync)`);
    }
  }
}

/**
 * 批次操作優化：分批處理大數組
 */
export async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize = 10
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

/**
 * 並行操作：使用 Promise.all 優化
 */
export async function promiseAllSettled<T>(
  promises: Promise<T>[]
): Promise<{ successful: T[]; failed: Error[] }> {
  const results = await Promise.allSettled(promises);
  return results.reduce(
    (acc, result) => {
      if (result.status === 'fulfilled') {
        acc.successful.push(result.value);
      } else {
        acc.failed.push(result.reason);
      }
      return acc;
    },
    { successful: [] as T[], failed: [] as Error[] }
  );
}

/**
 * 獲取性能報告
 */
export function getPerformanceReport() {
  const slowFunctions = performanceLog
    .filter(m => m.duration > 1000)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);

  const avgByFunction = performanceLog.reduce(
    (acc, m) => {
      if (!acc[m.functionName]) {
        acc[m.functionName] = { count: 0, totalTime: 0 };
      }
      acc[m.functionName].count++;
      acc[m.functionName].totalTime += m.duration;
      return acc;
    },
    {} as Record<string, { count: number; totalTime: number }>
  );

  return {
    totalCalls: performanceLog.length,
    slowFunctions,
    averageByFunction: Object.entries(avgByFunction).map(([name, data]) => ({
      name,
      count: data.count,
      avgTime: data.totalTime / data.count
    }))
  };
}

/**
 * 清除性能日誌
 */
export function clearPerformanceLog() {
  performanceLog.length = 0;
}
