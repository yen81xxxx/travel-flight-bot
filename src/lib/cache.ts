/**
 * 改進的緩存管理工具
 */

interface CacheEntry<T> {
  data: T;
  expires: number;
  createdAt: number;
  hits: number;
}

interface CacheStats {
  validItems: number;
  expiredItems: number;
  totalItems: number;
  totalHits: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * 設定快取值（帶 TTL）
 */
export function setCache(key: string, data: unknown, ttlSeconds: number = 3600): void {
  cache.set(key, {
    data,
    expires: Date.now() + ttlSeconds * 1000,
    createdAt: Date.now(),
    hits: 0
  });
}

/**
 * 取得快取值（帶命中計數）
 */
export function getCache<T = unknown>(key: string): T | null {
  const item = cache.get(key);
  if (!item) return null;

  const now = Date.now();
  if (now > item.expires) {
    cache.delete(key);
    return null;
  }

  item.hits++;
  return item.data as T;
}

/**
 * 檢查快取存在性
 */
export function hasCache(key: string): boolean {
  const item = cache.get(key);
  if (!item) return false;
  if (Date.now() > item.expires) {
    cache.delete(key);
    return false;
  }
  return true;
}

/**
 * 刪除快取（單個或全部）
 */
export function clearCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * 取得快取統計
 */
export function getCacheStats(): CacheStats {
  let validItems = 0;
  let expiredItems = 0;
  let totalHits = 0;
  const now = Date.now();

  for (const [, item] of cache) {
    if (now > item.expires) {
      expiredItems++;
    } else {
      validItems++;
      totalHits += item.hits;
    }
  }

  return {
    validItems,
    expiredItems,
    totalItems: cache.size,
    totalHits
  };
}

/**
 * 取得快取命中率
 */
export function getCacheHitRate(): number {
  const stats = getCacheStats();
  if (stats.totalHits === 0) return 0;
  return (stats.totalHits / (stats.totalHits + stats.expiredItems + 1)) * 100;
}
