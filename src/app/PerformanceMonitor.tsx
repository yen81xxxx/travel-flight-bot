'use client';

import { useEffect } from 'react';
import { monitorPerformance, setupSmartPreloading } from '@/lib/code-splitting';

/**
 * Performance monitoring component
 * Initializes Core Web Vitals collection and smart preloading
 * Should be placed in the root layout
 */
export default function PerformanceMonitor() {
  useEffect(() => {
    // Start collecting performance metrics
    monitorPerformance();

    // Setup intelligent module preloading based on user intent
    setupSmartPreloading();
  }, []);

  return null;
}
