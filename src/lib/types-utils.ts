/**
 * 共用的類型工具和守衛
 */

/**
 * 類型守衛：檢查是否為物件
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 類型守衛：檢查是否為陣列
 */
export function isArray<T = unknown>(value: unknown): value is T[] {
  return Array.isArray(value);
}

/**
 * 類型守衛：檢查是否為字符串
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * 類型守衛：檢查是否為數字
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * 類型守衛：檢查是否為布爾值
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * 類型守衛：檢查是否為 Error
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * 提取物件的部分屬性
 */
export function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return keys.reduce((acc, key) => {
    acc[key] = obj[key];
    return acc;
  }, {} as Pick<T, K>);
}

/**
 * 忽略物件的指定屬性
 */
export function omit<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const keySet = new Set(keys);
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !keySet.has(key as K))
  ) as Omit<T, K>;
}

/**
 * 深層合併物件
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target } as Record<string, any>;
  for (const key in source) {
    const sourceValue = source[key as keyof T];
    const targetValue = result[key];

    if (isObject(sourceValue) && isObject(targetValue)) {
      result[key] = deepMerge(targetValue as object, sourceValue as object);
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }
  return result as T;
}

/**
 * 空值合併（使用第一個非 null/undefined 值）
 */
export function coalesce<T>(...values: (T | null | undefined)[]): T | null {
  return values.find(v => v !== null && v !== undefined) ?? null;
}

/**
 * 有條件地添加屬性到物件
 */
export function conditionalAdd<T extends Record<string, unknown>>(
  obj: T,
  condition: boolean,
  key: keyof T,
  value: T[keyof T]
): T {
  return condition ? { ...obj, [key]: value } : obj;
}
