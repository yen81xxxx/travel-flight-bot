/**
 * 設計令牌 - 統一的設計系統
 * 支持深色模式、響應式設計、一致的視覺風格
 */

// ===== 色彩系統 =====
export const colors = {
  // 品牌色
  primary: {
    light: '#007AFF',
    main: '#0066FF',
    dark: '#0052CC',
    contrast: '#FFFFFF'
  },

  // 成功、警告、錯誤
  success: {
    light: '#34C759',
    main: '#28A745',
    dark: '#1e7e34',
    bg: '#F0FDF4',
    text: '#166534'
  },
  warning: {
    light: '#FF9500',
    main: '#FF8C00',
    dark: '#E67E00',
    bg: '#FEF3C7',
    text: '#92400E'
  },
  error: {
    light: '#FF3B30',
    main: '#FF2D55',
    dark: '#E63946',
    bg: '#FEE2E2',
    text: '#991B1B'
  },
  info: {
    light: '#00B4D8',
    main: '#0096D1',
    dark: '#0077B6',
    bg: '#E0F4FF',
    text: '#003D82'
  },

  // 中性色
  neutral: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
    950: '#030712'
  },

  // 深色模式
  dark: {
    bg: '#0F172A',
    surface: '#1E293B',
    border: '#334155',
    text: '#F1F5F9'
  }
};

// ===== 排版系統 =====
export const typography = {
  // 字體
  fontFamily: {
    base: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace'
  },

  // 尺寸和權重
  fontSize: {
    xs: '0.75rem',      // 12px
    sm: '0.875rem',     // 14px
    base: '1rem',       // 16px
    lg: '1.125rem',     // 18px
    xl: '1.25rem',      // 20px
    '2xl': '1.5rem',    // 24px
    '3xl': '1.875rem',  // 30px
    '4xl': '2.25rem',   // 36px
    '5xl': '3rem'       // 48px
  },

  fontWeight: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800
  },

  // 行高
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
    loose: 2
  },

  // 預設組合
  styles: {
    h1: {
      fontSize: '2.25rem',
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: '-0.02em'
    },
    h2: {
      fontSize: '1.875rem',
      fontWeight: 600,
      lineHeight: 1.3,
      letterSpacing: '-0.01em'
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 600,
      lineHeight: 1.4
    },
    body: {
      fontSize: '1rem',
      fontWeight: 400,
      lineHeight: 1.5
    },
    caption: {
      fontSize: '0.875rem',
      fontWeight: 500,
      lineHeight: 1.5,
      color: colors.neutral[600]
    }
  }
};

// ===== 間距系統 =====
export const spacing = {
  0: '0',
  1: '0.25rem',   // 4px
  2: '0.5rem',    // 8px
  3: '0.75rem',   // 12px
  4: '1rem',      // 16px
  5: '1.25rem',   // 20px
  6: '1.5rem',    // 24px
  8: '2rem',      // 32px
  10: '2.5rem',   // 40px
  12: '3rem',     // 48px
  16: '4rem',     // 64px
  20: '5rem',     // 80px
  24: '6rem'      // 96px
};

// ===== 陰影系統 =====
export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  focus: '0 0 0 3px rgba(0, 102, 255, 0.1)'
};

// ===== 邊框半徑 =====
export const borderRadius = {
  none: '0',
  sm: '0.25rem',  // 4px
  base: '0.5rem', // 8px
  md: '0.75rem',  // 12px
  lg: '1rem',     // 16px
  xl: '1.5rem',   // 24px
  full: '9999px'
};

// ===== 動畫和過渡 =====
export const animation = {
  duration: {
    fast: '150ms',
    base: '200ms',
    slow: '300ms',
    slower: '500ms'
  },
  easing: {
    linear: 'linear',
    ease: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
  }
};

// ===== 斷點 =====
export const breakpoints = {
  xs: '320px',
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px'
};

// ===== 可訪問性 WCAG =====
export const accessibility = {
  focusOutline: `2px solid ${colors.primary.main}`,
  focusOutlineOffset: '2px',
  minTouchTarget: '44px',  // WCAG AAA 最小點擊目標
  minColorContrast: 4.5    // WCAG AA 最小對比度
};

// ===== Z-索引 =====
export const zIndex = {
  hide: -1,
  auto: 'auto',
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  backdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070
};

// ===== 內容最大寬度 =====
export const maxWidth = {
  xs: '20rem',     // 320px
  sm: '24rem',     // 384px
  md: '28rem',     // 448px
  lg: '32rem',     // 512px
  xl: '36rem',     // 576px
  '2xl': '42rem',  // 672px
  '3xl': '48rem',  // 768px
  '4xl': '56rem',  // 896px
  '5xl': '64rem',  // 1024px
  '6xl': '72rem',  // 1152px
  '7xl': '80rem',  // 1280px
  full: '100%'
};
