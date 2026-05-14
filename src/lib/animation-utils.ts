/**
 * Animation utility functions for smooth transitions and interactions
 */

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.3 }
};

export const slideInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 20 },
  transition: { duration: 0.3 }
};

export const slideInDown = {
  initial: { opacity: 0, y: -20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: 0.3 }
};

export const slideInLeft = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.3 }
};

export const slideInRight = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
  transition: { duration: 0.3 }
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: 0.3 }
};

/**
 * CSS animation classnames for inline styles
 */
export const animationStyles = {
  fadeIn: `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    animation: fadeIn 0.3s ease-in-out;
  `,
  slideInUp: `
    @keyframes slideInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    animation: slideInUp 0.3s ease-in-out;
  `,
  slideInDown: `
    @keyframes slideInDown {
      from { opacity: 0; transform: translateY(-20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    animation: slideInDown 0.3s ease-in-out;
  `,
  pulse: `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  `
};

/**
 * Create a smooth transition on element
 */
export function createTransition(
  property: string | string[] = 'all',
  duration: number = 300,
  easing: string = 'ease-in-out'
): string {
  const props = Array.isArray(property) ? property : [property];
  return props.map(p => `${p} ${duration}ms ${easing}`).join(', ');
}

/**
 * Debounce animation frame updates
 */
export function requestAnimationFrameDebounce(
  callback: () => void,
  delay: number = 16
): () => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      requestAnimationFrame(callback);
    }, delay);
  };
}

/**
 * Stagger animation for lists
 */
export function getStaggerDelay(index: number, baseDelay: number = 50): number {
  return index * baseDelay;
}
