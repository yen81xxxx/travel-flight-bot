/**
 * 标准 API 响应格式
 */
export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  timestamp: string
}

/**
 * 分页响应格式
 */
export interface PaginatedResponse<T> {
  ok: boolean
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * 健康检查响应
 */
export interface HealthCheckResponse {
  ok: boolean
  checks: Record<string, { ok: boolean; detail?: string }>
  time: string
}

/**
 * 订阅信息
 */
export interface SubscriptionInfo {
  id: string
  sourceId: string
  origin: string
  destination: string
  maxPrice: number
  active: boolean
  createdAt: string
}

/**
 * 搜索结果
 */
export interface FlightSearchResult {
  origin: string
  destination: string
  outboundFlights: Flight[]
  returnFlights?: Flight[]
  lastUpdated: string
}

/**
 * 航班信息
 */
export interface Flight {
  price: number
  duration: number
  airline: string
  departureTime: string
  arrivalTime: string
}

/**
 * 错误响应
 */
export interface ErrorResponse {
  ok: false
  error: string
  code?: string
  details?: Record<string, unknown>
}
