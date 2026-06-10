/**
 * IntelPanel — building vs ready 兩種狀態
 *
 * Building state 的測試**特別重要**：產品定位是「資料不夠時不假裝有判斷」。
 * 一定要驗：
 *   - 不顯示 verdict / headline
 *   - 不顯示「建議入手 / 再等」字眼
 *   - 顯示「再 N 天解鎖」+ 進度條
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render } from '@testing-library/react';
import { IntelPanel } from '../IntelPanel';
import type { PriceIntel } from '../../_types';

const buildingIntel: PriceIntel = {
  status: 'building',
  tracked: 5,
  remaining: 9,
  target: 14,
  pct: 36,
  days: 60
};

const readyBuyIntel: PriceIntel = {
  status: 'ready',
  verdict: 'buy',
  headline: '現在就是好時機',
  percentile: 12,
  lo: 10000,
  hi: 14500,
  p25: 11200,
  p50: 12500,
  p75: 13800,
  confidence: '高',
  reasons: [
    { icon: 'trendDown', t: '逼近近 30 天最低（第 12 百分位）' },
    { icon: 'trendDown', t: '近一週下跌 6.2%' }
  ],
  days: 65,
  hitTarget: true,
  tracked: 30
};

const readyWaitIntel: PriceIntel = {
  status: 'ready',
  verdict: 'wait',
  headline: '目前偏高，建議再等',
  percentile: 82,
  lo: 10000,
  hi: 14500,
  p25: 11200,
  p50: 12500,
  p75: 13800,
  confidence: '中',
  reasons: [
    { icon: 'trendUp', t: '高於 82% 的歷史報價' },
    { icon: 'calendar', t: '距出發 120 天，仍有觀望時間' }
  ],
  days: 120,
  hitTarget: false,
  tracked: 28
};

describe('IntelPanel — building state（誠實 gate）', () => {
  it('render building panel + 顯示「情報建立中」+ 「再 N 天」', () => {
    const { getByTestId, container } = render(<IntelPanel intel={buildingIntel} />);
    expect(getByTestId('intel-panel-building')).toBeInTheDocument();
    expect(container.textContent).toContain('情報建立中');
    expect(container.textContent).toContain('再'); // 「再 N 天」
    expect(container.textContent).toContain('9'); // remaining
  });

  it('**絕對不能**顯示 verdict / headline 字眼', () => {
    const { container } = render(<IntelPanel intel={buildingIntel} />);
    // 不能含 verdict 用字（防止 building 仍然假裝有判斷）
    expect(container.textContent).not.toContain('建議入手');
    expect(container.textContent).not.toContain('建議再等');
    expect(container.textContent).not.toContain('現在就是好時機');
    expect(container.textContent).not.toContain('目前偏高');
  });

  it('progress bar width = pct%', () => {
    const { container } = render(<IntelPanel intel={buildingIntel} />);
    const fill = container.querySelector('.ip-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('36%');
  });

  it('顯示已累積 vs 目標天數', () => {
    const { container } = render(<IntelPanel intel={buildingIntel} />);
    expect(container.textContent).toContain('5');  // tracked
    expect(container.textContent).toContain('14'); // target
  });

  it('明說「目標價提醒仍正常運作」— 不讓使用者以為什麼都沒監控', () => {
    const { container } = render(<IntelPanel intel={buildingIntel} />);
    expect(container.textContent).toContain('目標價提醒');
  });
});

describe('IntelPanel — ready state buy', () => {
  it('render verdict badge + headline + reasons', () => {
    const { getByTestId, container } = render(<IntelPanel intel={readyBuyIntel} />);
    expect(getByTestId('intel-panel-ready').getAttribute('data-verdict')).toBe('buy');
    expect(getByTestId('verdict-badge')).toBeInTheDocument();
    expect(container.textContent).toContain('建議入手');  // verdict label
    expect(container.textContent).toContain('現在就是好時機');  // headline
    expect(container.textContent).toContain('信心度 高');
    expect(container.textContent).toContain('逼近近 30 天最低');
  });

  it('PercentileBar 拿 intel.percentile', () => {
    const { container } = render(<IntelPanel intel={readyBuyIntel} />);
    const bar = container.querySelector('[data-testid="percentile-bar"]');
    expect(bar?.getAttribute('data-percentile')).toBe('12');
  });
});

describe('IntelPanel — ready state wait（敢叫人別買的關鍵）', () => {
  it('render verdict=wait + 高百分位 reason', () => {
    const { getByTestId, container } = render(<IntelPanel intel={readyWaitIntel} />);
    expect(getByTestId('intel-panel-ready').getAttribute('data-verdict')).toBe('wait');
    expect(container.textContent).toContain('建議再等');
    expect(container.textContent).toContain('目前偏高，建議再等');
    expect(container.textContent).toContain('高於 82%');
  });

  it('PercentileBar marker 應該在偏左（指向「貴」）', () => {
    const { container } = render(<IntelPanel intel={readyWaitIntel} />);
    const marker = container.querySelector('.p-marker') as HTMLElement;
    // percentile=82 → marker left = 100-82 = 18%（偏左 = 偏貴端）
    expect(marker.style.left).toBe('18%');
  });
});
