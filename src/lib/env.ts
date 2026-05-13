/**
 * 環境變數驗證和管理
 */

/**
 * 環境變數列表
 */
const requiredEnvVars = [
  'SERPAPI_KEY',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'NEXT_PUBLIC_LIFF_ID',
  'NEXT_PUBLIC_APP_URL'
] as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const optionalEnvVars = [
  'DEFAULT_ORIGIN',
  'DEFAULT_DESTINATION',
  'LINE_DAILY_PUSH_TARGET',
  'DEBUG'
] as const;

/**
 * 驗證並取得必需的環境變數
 */
export function getRequiredEnv(key: typeof requiredEnvVars[number]): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * 取得可選的環境變數（帶預設值）
 */
export function getOptionalEnv(key: typeof optionalEnvVars[number], defaultValue: string = ''): string {
  return process.env[key] ?? defaultValue;
}

/**
 * 批量驗證所有必需的環境變數
 */
export function validateAllEnv(): Record<string, string> {
  const missing: string[] = [];
  const env: Record<string, string> = {};

  for (const key of requiredEnvVars) {
    const value = process.env[key];
    if (!value) {
      missing.push(key);
    } else {
      env[key] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  return env;
}

/**
 * 取得所有環境配置（必需 + 可選）
 */
export function getAllEnvConfig() {
  return {
    required: {
      SERPAPI_KEY: getRequiredEnv('SERPAPI_KEY'),
      LINE_CHANNEL_ACCESS_TOKEN: getRequiredEnv('LINE_CHANNEL_ACCESS_TOKEN'),
      LINE_CHANNEL_SECRET: getRequiredEnv('LINE_CHANNEL_SECRET'),
      NEXT_PUBLIC_LIFF_ID: getRequiredEnv('NEXT_PUBLIC_LIFF_ID'),
      NEXT_PUBLIC_APP_URL: getRequiredEnv('NEXT_PUBLIC_APP_URL')
    },
    optional: {
      DEFAULT_ORIGIN: getOptionalEnv('DEFAULT_ORIGIN', 'TPE'),
      DEFAULT_DESTINATION: getOptionalEnv('DEFAULT_DESTINATION', 'HND'),
      LINE_DAILY_PUSH_TARGET: getOptionalEnv('LINE_DAILY_PUSH_TARGET', ''),
      DEBUG: getOptionalEnv('DEBUG', 'false') === 'true'
    }
  };
}

/**
 * 在應用啟動時驗證環境
 */
export function validateEnvironment(): void {
  try {
    validateAllEnv();
    console.log('[env] All required environment variables are set');
  } catch (err) {
    console.error('[env] Environment validation failed:', err);
    process.exit(1);
  }
}
