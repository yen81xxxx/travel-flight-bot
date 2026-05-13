/**
 * 測試工具和模擬功能
 */

/**
 * 建立模擬的 Supabase 客戶端
 */
export function createMockSupabaseClient() {
  const mockData: Record<string, any[]> = {};

  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            gte: () => ({
              order: async () => ({ data: mockData[table] ?? [], error: null })
            }),
            async: async () => ({ data: mockData[table] ?? [], error: null })
          }),
          async: async () => ({ data: mockData[table] ?? [], error: null })
        }),
        async: async () => ({ data: mockData[table] ?? [], error: null })
      }),
      insert: (data: any) => ({
        async: async () => ({ data, error: null })
      }),
      update: (data: any) => ({
        eq: () => ({
          async: async () => ({ data, error: null })
        })
      }),
      delete: () => ({
        eq: () => ({
          async: async () => ({ count: 1, error: null })
        })
      })
    })
  };
}

/**
 * 建立模擬的 LINE 客戶端
 */
export function createMockLineClient() {
  return {
    replyMessage: async (params: any) => ({}),
    pushMessage: async (params: any) => ({}),
    broadcast: async (params: any) => ({})
  };
}

/**
 * 等待指定毫秒
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 建立模擬的搜尋結果
 */
export function createMockSearchResult() {
  return {
    outbound: [
      {
        origin: 'TPE',
        destination: 'HND',
        outbound_date: '2026-06-01',
        return_date: null,
        airline: 'EVA AIR',
        airline_code: 'BR',
        price: 15000,
        currency: 'TWD',
        duration_minutes: 180,
        stops: 0,
        flight_type: 'best',
        trip_leg: 'outbound'
      }
    ],
    return: [
      {
        origin: 'TPE',
        destination: 'HND',
        outbound_date: '2026-06-01',
        return_date: '2026-06-08',
        airline: 'EVA AIR',
        airline_code: 'BR',
        price: 30000,
        currency: 'TWD',
        duration_minutes: 180,
        stops: 0,
        flight_type: 'best',
        trip_leg: 'return'
      }
    ],
    fromCache: false,
    serpapiCalls: 2
  };
}

/**
 * 斷言函數相等
 */
export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected} but got ${actual}`);
  }
}

/**
 * 斷言函數拋出錯誤
 */
export async function assertThrows(fn: () => Promise<void>, errorMessage?: string): Promise<void> {
  try {
    await fn();
    throw new Error('Expected function to throw, but it did not');
  } catch (err) {
    if (errorMessage && !String(err).includes(errorMessage)) {
      throw new Error(`Expected error message to include "${errorMessage}", but got: ${err}`);
    }
  }
}

/**
 * 建立具有延遲的模擬函數
 */
export function createDelayedMock<T>(result: T, delayMs: number) {
  return async () => {
    await wait(delayMs);
    return result;
  };
}
