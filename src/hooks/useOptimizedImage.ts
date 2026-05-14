import { useMemo, useEffect } from 'react';
import { optimizeImage, preloadImage, getAspectRatioPadding } from '@/lib/image-optimizer';
import type { ImageConfig, OptimizedImage } from '@/lib/image-optimizer';

/**
 * React hook for optimizing images with responsive srcsets
 * Automatically generates srcsets, handles lazy loading, and prevents CLS
 */
export function useOptimizedImage(config: ImageConfig): OptimizedImage & { aspectRatioPadding: string } {
  const optimized = useMemo(() => optimizeImage(config), [config]);

  const aspectRatioPadding = useMemo(
    () => getAspectRatioPadding(config.width, config.height),
    [config.width, config.height]
  );

  useEffect(() => {
    // Preload on mount if priority or visible above fold
    if (typeof window !== 'undefined') {
      preloadImage(optimized.src);
    }
  }, [optimized.src]);

  return {
    ...optimized,
    aspectRatioPadding
  };
}
