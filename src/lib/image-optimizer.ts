/**
 * 圖片最佳化工具
 * 用於生成響應式圖片 srcset，優化加載性能
 */

export interface ImageConfig {
  src: string;
  alt: string;
  width: number;
  height: number;
  quality?: 75 | 80 | 85 | 90 | 95;
  format?: 'webp' | 'avif' | 'jpeg';
  sizes?: string;
}

export interface OptimizedImage {
  src: string;
  srcSet: string;
  sizes: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * 常用的響應式斷點
 */
export const RESPONSIVE_BREAKPOINTS = {
  mobile: 360,
  tablet: 768,
  desktop: 1024,
  wide: 1440
} as const;

/**
 * 生成圖片 srcset
 */
export function generateSrcSet(
  basePath: string,
  breakpoints: number[] = [360, 768, 1024, 1440]
): string {
  return breakpoints
    .map(bp => `${basePath}?w=${bp} ${bp}w`)
    .join(', ');
}

/**
 * 最佳化圖片配置
 */
export function optimizeImage(config: ImageConfig): OptimizedImage {
  const {
    src,
    alt,
    width,
    height,
    quality = 85,
    format = 'webp',
    sizes = '(max-width: 640px) 100vw, (max-width: 1024px) 75vw, 50vw'
  } = config;

  // 生成多個尺寸的圖片
  const breakpoints = [320, 640, 1024, 1280];
  const srcSet = breakpoints
    .map(bp => `${src}?w=${bp}&q=${quality}&fm=${format} ${bp}w`)
    .join(', ');

  return {
    src: `${src}?w=${width}&q=${quality}&fm=${format}`,
    srcSet,
    sizes,
    alt,
    width,
    height
  };
}

/**
 * 計算圖片縱橫比（用於防止 CLS）
 */
export function getAspectRatioPadding(width: number, height: number): string {
  const ratio = (height / width) * 100;
  return `${ratio}%`;
}

/**
 * 圖片預加載
 */
export function preloadImage(src: string): void {
  if (typeof window === 'undefined') return;

  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = src;
  document.head.appendChild(link);
}

/**
 * 批量圖片預加載
 */
export function preloadImages(sources: string[]): void {
  sources.forEach(src => preloadImage(src));
}

/**
 * 圖片延遲加載（Intersection Observer）
 */
export function setupLazyLoading(): void {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target as HTMLImageElement;
        const src = img.dataset.src;

        if (src) {
          img.src = src;
          img.removeAttribute('data-src');
          observer.unobserve(img);
        }
      }
    });
  });

  // 觀察所有 data-src 的圖片
  document.querySelectorAll('img[data-src]').forEach(img => {
    observer.observe(img);
  });
}

/**
 * 檢查瀏覽器是否支持 WebP
 */
export async function supportsWebP(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  return new Promise(resolve => {
    const webP = new Image();
    webP.onload = webP.onerror = () => {
      resolve(webP.height === 2);
    };
    webP.src = 'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAAA8AwCdASoCAAEALmcgJaACdLoB/AOkA+QA';
  });
}

/**
 * 獲取最優圖片格式
 */
export async function getBestImageFormat(): Promise<'webp' | 'avif' | 'jpeg'> {
  if (await supportsWebP()) {
    return 'webp';
  }
  return 'jpeg';
}
