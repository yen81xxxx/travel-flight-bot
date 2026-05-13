const cache = new Map<string, { data: unknown; expires: number }>()

export function setCache(key: string, data: unknown, ttlSeconds: number = 3600): void {
  cache.set(key, { data, expires: Date.now() + ttlSeconds * 1000 })
}

export function getCache(key: string): unknown {
  const item = cache.get(key)
  if (!item) return null
  if (Date.now() > item.expires) {
    cache.delete(key)
    return null
  }
  return item.data
}

export function clearCache(key?: string): void {
  if (key) {
    cache.delete(key)
  } else {
    cache.clear()
  }
}

export function getCacheStats() {
  let validItems = 0
  let expiredItems = 0
  const now = Date.now()

  for (const [, item] of cache) {
    if (now > item.expires) {
      expiredItems++
    } else {
      validItems++
    }
  }

  return { validItems, expiredItems, totalItems: cache.size }
}
