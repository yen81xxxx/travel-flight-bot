import crypto from 'crypto'

/**
 * 验证 LINE Webhook 签名
 * @param body 原始请求体
 * @param signature 来自 X-Line-Signature 头
 * @returns 签名是否有效
 */
export function validateLineSignature(body: string, signature: string): boolean {
  const channelSecret = process.env.LINE_CHANNEL_SECRET
  if (!channelSecret) {
    console.warn('LINE_CHANNEL_SECRET not set')
    return false
  }

  const hash = crypto.createHmac('sha256', channelSecret).update(body).digest('base64')
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature))
}

/**
 * 验证 CRON 请求的安全令牌
 * @param token 从请求头提供的令牌
 * @returns 令牌是否有效
 */
export function validateCronSecret(token?: string): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.warn('CRON_SECRET not set')
    return false
  }

  if (!token) {
    return false
  }

  return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(token))
}

/**
 * 生成安全的随机令牌
 * @param length 令牌长度（字节）
 * @returns 十六进制编码的令牌
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex')
}

/**
 * 检查环境变量是否安全
 * @returns 缺失的必需环境变量列表
 */
export function checkEnvironmentSecurity(): string[] {
  const required = [
    'SERPAPI_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE_CHANNEL_SECRET',
    'CRON_SECRET',
  ]

  return required.filter(key => !process.env[key])
}
