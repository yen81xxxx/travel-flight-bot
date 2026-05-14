import { useEffect, useCallback } from 'react';
import { useABTest } from '@/lib/ab-testing';
import { useLiff } from './useLiff';

/**
 * A/B testing hook for search form
 * Tracks user journey through the 3-step booking flow
 */
export function useSearchFormAB() {
  const { user } = useLiff(process.env.NEXT_PUBLIC_LIFF_ID || '');
  const userId = user?.userId || 'anonymous';
  const { variant, recordEvent, isControl, isVariantA, isVariantB, isVariantC } = useABTest('search-flow', userId);

  // Track when form is viewed
  useEffect(() => {
    recordEvent('view', 'form-loaded', { variant });
  }, [variant, recordEvent]);

  // Track step transitions
  const trackStepTransition = useCallback(
    (fromStep: number, toStep: number) => {
      recordEvent('click', `step-${fromStep}-to-${toStep}`, {
        fromStep,
        toStep
      });
    },
    [recordEvent]
  );

  // Track form submission
  const trackFormSubmit = useCallback(
    (step: number) => {
      recordEvent('conversion', `step-${step}-submit`, {
        completedStep: step
      });
    },
    [recordEvent]
  );

  // Track form abandonment
  const trackAbandonement = useCallback(
    (step: number, reason?: string) => {
      recordEvent('bounce', `step-${step}-abandon`, {
        abandonedStep: step,
        reason
      });
    },
    [recordEvent]
  );

  return {
    variant,
    isControl,
    isVariantA,
    isVariantB,
    isVariantC,
    trackStepTransition,
    trackFormSubmit,
    trackAbandonement
  };
}
