'use client';

import { ReactNode, Suspense } from 'react';
import { Spinner } from './Spinner';

interface LazyPageLoaderProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Wrapper component for lazy loading page content
 * Shows a spinner while the page is loading
 *
 * Usage:
 * <LazyPageLoader>
 *   <SearchFormV2 />
 * </LazyPageLoader>
 */
export function LazyPageLoader({
  children,
  fallback = (
    <div className="flex items-center justify-center min-h-screen">
      <Spinner size="lg" />
    </div>
  )
}: LazyPageLoaderProps) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}
