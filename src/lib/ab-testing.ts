/**
 * A/B 測試框架
 * 用於轉換率優化和用戶行為分析
 */

export type Variant = 'control' | 'variant_a' | 'variant_b' | 'variant_c';

export interface ABTestConfig {
  testId: string;
  name: string;
  description: string;
  variants: Variant[];
  weights: Record<Variant, number>; // 流量分配比例
  startDate: Date;
  endDate: Date;
  active: boolean;
}

export interface ABTestEvent {
  testId: string;
  userId: string;
  variant: Variant;
  eventType: 'view' | 'click' | 'conversion' | 'bounce';
  eventName: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * A/B 測試管理器
 */
class ABTestManager {
  private tests: Map<string, ABTestConfig> = new Map();
  private userVariants: Map<string, Record<string, Variant>> = new Map();
  private events: ABTestEvent[] = [];

  /**
   * 註冊 A/B 測試
   */
  registerTest(config: ABTestConfig): void {
    this.tests.set(config.testId, config);
  }

  /**
   * 為用戶分配變體（一致性哈希）
   */
  assignVariant(testId: string, userId: string): Variant {
    // 檢查用戶是否已分配過
    if (this.userVariants.has(userId)) {
      const userTests = this.userVariants.get(userId)!;
      if (userTests[testId]) {
        return userTests[testId];
      }
    }

    // 根據權重分配新變體
    const test = this.tests.get(testId);
    if (!test || !test.active) {
      return 'control';
    }

    // 簡單的加權隨機分配
    const random = Math.random();
    let sum = 0;
    for (const [variant, weight] of Object.entries(test.weights)) {
      sum += weight;
      if (random <= sum) {
        const variantMap = this.userVariants.get(userId) || {};
        variantMap[testId] = variant as Variant;
        this.userVariants.set(userId, variantMap);
        return variant as Variant;
      }
    }

    return 'control';
  }

  /**
   * 記錄事件
   */
  recordEvent(event: ABTestEvent): void {
    this.events.push(event);

    // 可以在這裡實現事件持久化或發送到分析服務
    this.persistEvent(event);
  }

  /**
   * 獲取測試統計
   */
  getTestStats(testId: string): Record<string, any> {
    const test = this.tests.get(testId);
    if (!test) return {};

    const stats: Record<string, any> = {};
    for (const variant of test.variants) {
      const events = this.events.filter(e => e.testId === testId && e.variant === variant);
      const conversions = events.filter(e => e.eventType === 'conversion').length;
      const views = events.filter(e => e.eventType === 'view').length;

      stats[variant] = {
        events: events.length,
        views,
        conversions,
        conversionRate: views > 0 ? (conversions / views * 100).toFixed(2) + '%' : '0%',
        bounceRate: ((events.filter(e => e.eventType === 'bounce').length / (views || 1)) * 100).toFixed(2) + '%'
      };
    }

    return stats;
  }

  /**
   * 內部方法：持久化事件
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private persistEvent(_event: ABTestEvent): void {
    try {
      // 可以發送到服務端
      if (typeof window !== 'undefined') {
        // 批量發送（可選）
        // fetch('/api/ab-test/events', { method: 'POST', body: JSON.stringify(_event) })
      }
    } catch (err) {
      console.error('[ABTest] Failed to persist event:', err);
    }
  }
}

// 全局單例
export const abTestManager = new ABTestManager();

/**
 * React Hook: 使用 A/B 測試
 */
export function useABTest(testId: string, userId: string) {
  const [variant, setVariant] = React.useState<Variant>('control');

  React.useEffect(() => {
    const assigned = abTestManager.assignVariant(testId, userId);
    setVariant(assigned);
  }, [testId, userId]);

  const recordEvent = (eventType: 'view' | 'click' | 'conversion' | 'bounce', eventName: string, metadata?: Record<string, any>) => {
    abTestManager.recordEvent({
      testId,
      userId,
      variant,
      eventType,
      eventName,
      timestamp: Date.now(),
      metadata
    });
  };

  return {
    variant,
    recordEvent,
    isControl: variant === 'control',
    isVariantA: variant === 'variant_a',
    isVariantB: variant === 'variant_b',
    isVariantC: variant === 'variant_c'
  };
}

import React from 'react';
