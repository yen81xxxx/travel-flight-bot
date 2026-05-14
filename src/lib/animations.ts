/**
 * 動畫和微交互配置
 */

/**
 * 動畫預設
 */
export const animations = {
  // 淡入淡出
  fadeIn: {
    duration: 200,
    easing: 'ease-out'
  },
  fadeOut: {
    duration: 150,
    easing: 'ease-in'
  },

  // 滑動
  slideInUp: {
    duration: 300,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },
  slideInDown: {
    duration: 300,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },
  slideOutUp: {
    duration: 250,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },

  // 縮放
  scaleIn: {
    duration: 200,
    easing: 'cubic-bezier(0.4, 0, 1, 1)'
  },
  scaleOut: {
    duration: 150,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },

  // 旋轉
  spin: {
    duration: 1000,
    easing: 'linear',
    infinite: true
  },

  // 脈動
  pulse: {
    duration: 2000,
    easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    infinite: true
  },

  // 抖動
  shake: {
    duration: 500,
    easing: 'ease-in-out'
  },

  // 反彈
  bounce: {
    duration: 500,
    easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)'
  }
};

/**
 * 微交互預設
 */
export const microInteractions = {
  // 按鈕點擊
  buttonPress: {
    scale: 0.95,
    duration: 100,
    easing: 'ease-out'
  },

  // 懸停效果
  hover: {
    shadowBlur: 12,
    duration: 200,
    easing: 'ease-out'
  },

  // 焦點環
  focus: {
    ringWidth: 2,
    ringColor: '#0066ff',
    duration: 150
  },

  // 加載狀態
  loading: {
    spinDuration: 1000,
    dotSize: 8,
    dotGap: 4
  },

  // 提示消息
  toast: {
    slideInDuration: 300,
    slideOutDuration: 300,
    visibleDuration: 5000
  },

  // 模態彈窗
  modal: {
    backdropFadeDuration: 200,
    contentSlideDuration: 300,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
  }
};

/**
 * 性能優化建議
 */
export const performanceMetrics = {
  // 首次內容繪製目標
  fcp: 1200, // ms
  // 最大內容繪製目標
  lcp: 2500, // ms
  // 首次輸入延遲目標
  fid: 100, // ms
  // 累積佈局偏移目標
  cls: 0.1,
  // 總阻塞時間目標
  tbt: 200 // ms
};

/**
 * 動畫 CSS 生成器
 */
export function generateAnimationCSS(name: string, animation: any): string {
  const { duration = 200, easing = 'ease-out', infinite = false } = animation;

  return `
    animation: ${name} ${duration}ms ${easing} ${infinite ? 'infinite' : 'forwards'};
  `;
}

/**
 * 獲取動畫延遲（分級）
 */
export function getAnimationDelay(index: number, baseDelay: number = 50): number {
  return index * baseDelay;
}

/**
 * 批量動畫管理
 */
export class AnimationController {
  private animations: Map<string, Animation> = new Map();

  /**
   * 啟動動畫
   */
  play(elementId: string, animationName: string, config: any): void {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.style.animation = `${animationName} ${config.duration}ms ${config.easing}`;
  }

  /**
   * 暫停所有動畫
   */
  pauseAll(): void {
    document.querySelectorAll('[style*="animation"]').forEach(el => {
      (el as HTMLElement).style.animationPlayState = 'paused';
    });
  }

  /**
   * 繼續所有動畫
   */
  resumeAll(): void {
    document.querySelectorAll('[style*="animation"]').forEach(el => {
      (el as HTMLElement).style.animationPlayState = 'running';
    });
  }

  /**
   * 清除所有動畫
   */
  clear(): void {
    document.querySelectorAll('[style*="animation"]').forEach(el => {
      (el as HTMLElement).style.animation = 'none';
    });
  }
}

export const animationController = new AnimationController();
