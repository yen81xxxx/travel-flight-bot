/**
 * useForm Hook - 表單狀態和驗證管理
 */

import { useState, useCallback } from 'react';

export interface FormErrors {
  [key: string]: string | undefined;
}

export interface UseFormReturn<T> {
  values: T;
  errors: FormErrors;
  touched: { [key in keyof T]?: boolean };
  setValue: <K extends keyof T>(field: K, value: T[K]) => void;
  setError: (field: string, error: string) => void;
  clearError: (field?: string) => void;
  setTouched: (field: keyof T, touched?: boolean) => void;
  reset: (newValues?: Partial<T>) => void;
  isValid: boolean;
  isDirty: boolean;
}

/**
 * 表單狀態管理 Hook
 */
export function useForm<T extends Record<string, any>>(
  initialValues: T,
  validators?: Partial<Record<keyof T, (value: any) => string | undefined>>
): UseFormReturn<T> {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouchedState] = useState<{ [key in keyof T]?: boolean }>({});

  // 更新單個欄位值
  const setValue = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValues(prev => ({ ...prev, [field]: value }));

    // 自動驗證
    if (validators && validators[field]) {
      const error = validators[field]!(value);
      if (error) {
        setErrors(prev => ({ ...prev, [field]: error }));
      } else {
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors[field as string];
          return newErrors;
        });
      }
    }
  }, [validators]);

  // 設定錯誤訊息
  const setError = useCallback((field: string, error: string) => {
    setErrors(prev => ({ ...prev, [field]: error }));
  }, []);

  // 清除錯誤訊息
  const clearError = useCallback((field?: string) => {
    if (field) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    } else {
      setErrors({});
    }
  }, []);

  // 標記欄位已接觸
  const setTouched = useCallback((field: keyof T, touchedVal = true) => {
    setTouchedState(prev => ({ ...prev, [field]: touchedVal }));
  }, []);

  // 重置表單
  const reset = useCallback((newValues?: Partial<T>) => {
    setValues(prev => ({ ...prev, ...newValues }));
    setErrors({});
    setTouchedState({});
  }, []);

  // 計算欄位是否有效
  const isValid = Object.keys(errors).length === 0;

  // 計算表單是否有修改
  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);

  return {
    values,
    errors,
    touched,
    setValue,
    setError,
    clearError,
    setTouched,
    reset,
    isValid,
    isDirty
  };
}
