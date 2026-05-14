import React, { ImgHTMLAttributes, useState } from 'react';
import { useOptimizedImage } from '@/hooks/useOptimizedImage';
import type { ImageConfig } from '@/lib/image-optimizer';

interface OptimizedImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'srcSet' | 'sizes'> {
  config: ImageConfig;
  containerClassName?: string;
  lazy?: boolean;
}

/**
 * Optimized Image Component
 * Automatically handles responsive srcsets, lazy loading, and CLS prevention
 *
 * Usage:
 * <OptimizedImage
 *   config={{
 *     src: '/images/flight.jpg',
 *     alt: 'Flight booking',
 *     width: 800,
 *     height: 600,
 *     quality: 85,
 *     format: 'webp'
 *   }}
 *   lazy
 * />
 */
export const OptimizedImage = React.forwardRef<
  HTMLImageElement,
  OptimizedImageProps
>(({ config, containerClassName, lazy = true, ...imgProps }, ref) => {
  const optimized = useOptimizedImage(config);
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div
      className={containerClassName}
      style={{
        paddingBottom: optimized.aspectRatioPadding,
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <img
        ref={ref}
        src={lazy ? undefined : optimized.src}
        data-src={lazy ? optimized.src : undefined}
        srcSet={optimized.srcSet}
        sizes={optimized.sizes}
        alt={optimized.alt}
        width={optimized.width}
        height={optimized.height}
        onLoad={() => setIsLoaded(true)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          opacity: isLoaded ? 1 : 0,
          transition: 'opacity 0.3s ease-in-out'
        }}
        {...imgProps}
      />
    </div>
  );
});

OptimizedImage.displayName = 'OptimizedImage';
