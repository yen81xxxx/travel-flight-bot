/**
 * PriceChart — scaling、target line、markers、tick indices
 *
 * 跟 Sparkline 不同的關鍵測試：
 *   - target 被算進 min/max → 即使 target 超出歷史 range 也畫得出來
 *   - latest marker 顏色：當前價 ≤ target → 綠；超過 → accent (cyan/yellow)
 *   - min marker 位置：series 最低點（不一定是頭尾）
 *   - x 軸 3 個刻度：[0, mid, len-1]
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render } from '@testing-library/react';
import { PriceChart, computePriceChartScale, computeTickIndices } from '../PriceChart';

const mkHistory = (prices: number[]): { d: string; p: number }[] =>
  prices.map((p, i) => ({ d: `6/${i + 1}`, p }));

describe('computePriceChartScale — Y 軸 padding 邏輯', () => {
  it('正常範圍 → 上下各 padding 12%', () => {
    const { min, max, span } = computePriceChartScale([10000, 12000, 14000], 13000);
    // hi=14000, lo=10000, pad = 4000 * 0.12 = 480
    expect(min).toBeCloseTo(10000 - 480, 5);
    expect(max).toBeCloseTo(14000 + 480, 5);
    expect(span).toBeCloseTo(max - min, 5);
  });

  it('target 在 prices 之外 → 也納入 lo/hi 計算', () => {
    // 全部價格 10k-12k，但 target=8k → lo 應該是 8k
    const { min, max } = computePriceChartScale([10000, 11000, 12000], 8000);
    // lo=8000, hi=12000, pad = 4000*0.12=480
    expect(min).toBeCloseTo(8000 - 480, 5);
    expect(max).toBeCloseTo(12000 + 480, 5);
  });

  it('全平資料 (hi==lo) → fallback pad=500', () => {
    const { min, max } = computePriceChartScale([10000, 10000, 10000], 10000);
    expect(min).toBe(10000 - 500);
    expect(max).toBe(10000 + 500);
  });
});

describe('computeTickIndices — 3 個 x 軸刻度', () => {
  it('30 點 → [0, 14, 29]', () => {
    expect(computeTickIndices(30)).toEqual([0, 14, 29]);
  });

  it('2 點 → [0, 0, 1]（mid 退化到 0）', () => {
    expect(computeTickIndices(2)).toEqual([0, 0, 1]);
  });

  it('1 點 → [0, 0, 0]（雖然 component 會 return null 沒用到）', () => {
    expect(computeTickIndices(1)).toEqual([0, 0, 0]);
  });

  it('奇數長度 → mid 是中間索引', () => {
    expect(computeTickIndices(7)).toEqual([0, 3, 6]);
  });
});

describe('PriceChart — render coverage', () => {
  it('正常 30 點 → svg + target line + min marker + latest marker', () => {
    const { getByTestId, container } = render(
      <PriceChart
        history={mkHistory(Array.from({ length: 30 }, (_, i) => 14000 - i * 100))}
        target={12000}
      />
    );
    expect(getByTestId('price-chart')).toBeInTheDocument();
    expect(getByTestId('target-line')).toBeInTheDocument();
    expect(getByTestId('price-line')).toBeInTheDocument();
    expect(getByTestId('min-marker')).toBeInTheDocument();
    expect(getByTestId('latest-marker')).toBeInTheDocument();
    // 3 個 x 軸 text label
    const textLabels = container.querySelectorAll('text');
    expect(textLabels.length).toBeGreaterThanOrEqual(3); // 目標label + 3 ticks
  });

  it('1 點 history → return null', () => {
    const { container } = render(<PriceChart history={mkHistory([12000])} target={12000} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('空 history → return null', () => {
    const { container } = render(<PriceChart history={[]} target={12000} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('當前價 ≤ target → latest marker 變綠（已達標）', () => {
    const { getByTestId } = render(
      <PriceChart history={mkHistory([14000, 13000, 11000])} target={12000} />
    );
    // last price 11000 < target 12000 → fill = ios-green
    expect(getByTestId('latest-marker').getAttribute('fill')).toBe('var(--ios-green)');
  });

  it('當前價 > target → latest marker 走 accent（預設 cyan）', () => {
    const { getByTestId } = render(
      <PriceChart history={mkHistory([12000, 13000, 14000])} target={12000} />
    );
    expect(getByTestId('latest-marker').getAttribute('fill')).toBe('var(--ios-cyan)');
  });

  it('accent prop 改主色 → price-line stroke + latest marker (未達標時) 跟著', () => {
    const { getByTestId } = render(
      <PriceChart
        history={mkHistory([12000, 13000, 14000])}
        target={12000}
        accent="var(--ios-yellow)"
      />
    );
    expect(getByTestId('price-line').getAttribute('stroke')).toBe('var(--ios-yellow)');
    expect(getByTestId('latest-marker').getAttribute('fill')).toBe('var(--ios-yellow)');
  });

  it('target line dashed + 綠色', () => {
    const { getByTestId } = render(
      <PriceChart history={mkHistory([12000, 13000])} target={12000} />
    );
    const tl = getByTestId('target-line');
    expect(tl.getAttribute('stroke')).toBe('var(--ios-green)');
    expect(tl.getAttribute('stroke-dasharray')).toBe('4 4');
  });

  it('目標 label 顯示 toLocaleString 格式（千分位）', () => {
    const { container } = render(
      <PriceChart history={mkHistory([12000, 13000])} target={28500} />
    );
    // 找到「目標 28,500」的文字
    expect(container.textContent).toContain('目標 28,500');
  });
});
