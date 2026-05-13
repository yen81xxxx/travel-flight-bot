/**
 * Loading 組件 - 通用的加載狀態顯示
 */

interface LoadingProps {
  message?: string;
  fullScreen?: boolean;
}

export function Loading({ message = 'Loading...', fullScreen = false }: LoadingProps) {
  const containerClass = fullScreen
    ? 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50'
    : 'flex items-center justify-center p-4';

  return (
    <div className={containerClass}>
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        {message && <p className="text-gray-600 text-sm">{message}</p>}
      </div>
    </div>
  );
}

/**
 * Skeleton Loading - 骨架屏加載
 */
interface SkeletonProps {
  count?: number;
  height?: string;
}

export function Skeleton({ count = 3, height = '1rem' }: SkeletonProps) {
  return (
    <div className="space-y-4">
      {Array(count).fill(0).map((_, i) => (
        <div key={i} style={{ height }} className="bg-gray-200 rounded animate-pulse"></div>
      ))}
    </div>
  );
}
