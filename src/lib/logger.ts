enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

// ===== 日誌級別順序（越往後越嚴重） =====
const LOG_LEVELS = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR] as const;

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: Record<string, unknown>
  error?: {
    message: string
    stack?: string
  }
}

/**
 * 建構日誌條目，自動過濾 undefined 的欄位
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  if (context) entry.context = context;
  if (error) entry.error = { message: error.message, stack: error.stack };
  return entry;
}

class Logger {
  private level: LogLevel = LogLevel.INFO

  setLevel(level: LogLevel) {
    this.level = level
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (this.shouldLog(level)) {
      const entry = createLogEntry(level, message, context, error);
      console.log(JSON.stringify(entry))
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(this.level)
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context)
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context)
  }

  warn(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.WARN, message, context, error)
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error)
  }
}

const logger = new Logger()

/**
 * 將任意值轉換為 Error 對象
 */
function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function logError(err: unknown, context?: Record<string, unknown>) {
  logger.error('Unhandled error', context, toError(err))
}

export function logInfo(msg: string, data?: Record<string, unknown>) {
  logger.info(msg, data)
}

export { logger, LogLevel }
