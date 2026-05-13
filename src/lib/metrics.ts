interface Metrics {
  searchCount: number
  notificationsSent: number
  errors: number
  averageResponseTime: number
  lastErrorTime?: string
}

const metrics: Metrics = {
  searchCount: 0,
  notificationsSent: 0,
  errors: 0,
  averageResponseTime: 0,
}

const responseTimes: number[] = []

export function recordSearch(): void {
  metrics.searchCount++
}

export function recordNotification(): void {
  metrics.notificationsSent++
}

export function recordError(): void {
  metrics.errors++
  metrics.lastErrorTime = new Date().toISOString()
}

export function recordResponseTime(ms: number): void {
  responseTimes.push(ms)
  if (responseTimes.length > 1000) {
    responseTimes.shift()
  }
  metrics.averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
}

export function getMetrics(): Metrics {
  return { ...metrics }
}

export function resetMetrics(): void {
  metrics.searchCount = 0
  metrics.notificationsSent = 0
  metrics.errors = 0
  metrics.lastErrorTime = undefined
  responseTimes.length = 0
}
