/**
 * Resource hints for performance optimization
 * Preconnect, DNS prefetch, and preload critical resources
 * Should be placed in the document head
 */
export default function ResourceHints() {
  return (
    <>
      {/* Preconnect to API endpoints for faster connections */}
      <link rel="preconnect" href="https://api.line.me" crossOrigin="anonymous" />

      {/* DNS prefetch for external services */}
      <link rel="dns-prefetch" href="https://liff.line.me" />

      {/* Preload critical fonts if any (future optimization) */}
      {/* Prefetch next page resources for SPA-like navigation */}
      <link rel="prefetch" href="/api/subscriptions" as="fetch" crossOrigin="anonymous" />
      <link rel="prefetch" href="/api/settings" as="fetch" crossOrigin="anonymous" />
    </>
  );
}
