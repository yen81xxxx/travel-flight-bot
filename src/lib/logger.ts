/**
 * 錯誤日誌封裝。
 * 預設輸出到 console。
 * 之後想接 Sentry：
 *   1. npm install @sentry/nextjs
 *   2. 跑 npx @sentry/wizard@latest -i nextjs
 *   3. 把 captureException 換成 Sentry.captureException
 */

export function logError(err: unknown, context?: Record<string, unknown>) {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  console.error('[error]', msg, { context, stack });

  // 之後可在這加 Sentry：
  // if (typeof Sentry !== 'undefined') {
  //   Sentry.captureException(err, { extra: context });
  // }
}

export function logInfo(msg: string, data?: Record<string, unknown>) {
  console.log('[info]', msg, data ?? '');
}
