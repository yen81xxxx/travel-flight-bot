/**
 * 統一的輸入驗證工具
 */

import { createValidationError } from './error-handler';

/**
 * 驗證 IATA 機場代碼格式（3 個大寫字母）
 */
export function validateIATACode(code: unknown): asserts code is string {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) {
    throw createValidationError('Invalid IATA code format', { value: code });
  }
}

/**
 * 驗證日期格式（YYYY-MM-DD）
 */
export function validateDateFormat(date: unknown): asserts date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createValidationError('Invalid date format', { value: date, expected: 'YYYY-MM-DD' });
  }
}

/**
 * 驗證日期邏輯（回程 >= 去程）
 */
export function validateDateRange(outbound: string, returnDate: string): void {
  const outboundDate = new Date(outbound);
  const retDate = new Date(returnDate);

  if (isNaN(outboundDate.getTime()) || isNaN(retDate.getTime())) {
    throw createValidationError('Invalid date values');
  }

  if (retDate < outboundDate) {
    throw createValidationError('Return date must be after outbound date', {
      outbound,
      return: returnDate
    });
  }
}

/**
 * 驗證非空字符串
 */
export function validateNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createValidationError(`${fieldName} cannot be empty`);
  }
}

/**
 * 驗證正整數
 */
export function validatePositiveInteger(value: unknown, fieldName: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw createValidationError(`${fieldName} must be a positive integer`, { value });
  }
}

/**
 * 驗證物件鍵值存在
 */
export function validateRequiredFields<T extends Record<string, unknown>>(
  obj: unknown,
  fields: Array<keyof T>
): asserts obj is T {
  if (typeof obj !== 'object' || obj === null) {
    throw createValidationError('Expected an object');
  }

  const missing = fields.filter(field => !(field in obj));
  if (missing.length > 0) {
    throw createValidationError('Missing required fields', { missing });
  }
}

/**
 * 批量驗證（組合多個驗證）
 */
export function validateSearchParams(params: unknown): asserts params is { origin: string; destination: string; outboundDate: string; returnDate?: string } {
  validateRequiredFields<{ origin: string; destination: string; outboundDate: string }>(params, ['origin', 'destination', 'outboundDate']);

  const obj = params as Record<string, unknown>;
  validateIATACode(obj.origin);
  validateIATACode(obj.destination);
  validateDateFormat(obj.outboundDate);

  if (obj.returnDate) {
    validateDateFormat(obj.returnDate);
    validateDateRange(obj.outboundDate as string, obj.returnDate as string);
  }
}

/**
 * 安全的類型保護轉換
 */
export function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw createValidationError('Expected string', { received: typeof value });
  }
  return value;
}

export function asNumber(value: unknown): number {
  const num = Number(value);
  if (isNaN(num)) {
    throw createValidationError('Expected number', { received: typeof value });
  }
  return num;
}

export function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw createValidationError('Expected boolean');
}
