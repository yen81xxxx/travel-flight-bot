/**
 * Sparkline — scaling 數學 + color logic + degenerate cases
 *
 * Scaling 數學踩過的雷：
 *   - 全平資料（max==min）→ span=0 除錯 → 必須 fallback span=1
 *   - 1 點資料 → 不能畫任何 path（render null）
 *   - 漲跌色 pick：純跌（end ≤ start）綠、純漲紅
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render } from '@testing-library/react';
import { Sparkline, pickSparklineColor } from '../Sparkline';

const mkHistory = (prices: number[]): { d: string; p: number }[] =>
  prices.map((p, i) => ({ d: `6/${i + 1}`, p }));

describe('pickSparklineColor — 漲跌色邏輯', () => {
  it('end < start → 綠（跌）', () => {
    expect(pickSparklineColor([100, 90, 80])).toBe('var(--ios-green)');
  });

  it('end == start → 綠（平視為非漲，靠 caller 自己判斷）', () => {
    // 設計手冊原文 net-down 用 <=，所以平的歸綠
    expect(pickSparklineColor([100, 100])).toBe('var(--ios-green)');
  });

  it('end > start → 紅（漲）', () => {
    expect(pickSparklineColor([80, 90, 100])).toBe('var(--ios-red)');
  });

  it('1 點以下 → fallback 中性色（避免 NaN/拋例外）', () => {
    expect(pickSparklineColor([100])).toBe('var(--ios-label-3)');
    expect(pickSparklineColor([])).toBe('var(--ios-label-3)');
  });
});

describe('Sparkline — render coverage', () => {
  it('正常 30 點 → 吐出 svg 含 line + area + 終點 circle', () => {
    const { container, getByTestId } = render(
      <Sparkline history={mkHistory(Array.from({ length: 30 }, (_, i) => 100 - i))} />
    );
    expect(getByTestId('sparkline')).toBeInTheDocument();
    expect(getByTestId('sparkline-line')).toBeInTheDocument();
    // 兩條 path（area + line）+ 1 圓 + 1 linearGradient
    expect(container.querySelectorAll('path').length).toBe(2);
    expect(container.querySelectorAll('circle').length).toBe(1);
    expect(container.querySelector('linearGradient')).toBeInTheDocument();
  });

  it('全平 history (max=min) → 不 crash、span 用 fallback 1', () => {
    const { getByTestId } = render(<Sparkline history={mkHistory([1000, 1000, 1000])} />);
    expect(getByTestId('sparkline-line')).toBeInTheDocument();
    // line 的 d 字串應是合法（含 M 跟 L），沒有 NaN
    const d = getByTestId('sparkline-line').getAttribute('d') ?? '';
    expect(d).toMatch(/^M/);
    expect(d).not.toMatch(/NaN/);
  });

  it('1 點 history → 不畫圖（return null）', () => {
    const { container } = render(<Sparkline history={mkHistory([100])} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('空 history → 不畫圖', () => {
    const { container } = render(<Sparkline history={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('color prop 覆寫自動判色', () => {
    const { getByTestId } = render(
      <Sparkline history={mkHistory([100, 200])} color="var(--ios-purple)" />
    );
    expect(getByTestId('sparkline-line').getAttribute('stroke')).toBe('var(--ios-purple)');
  });

  it('width / height props 套到 svg attribute', () => {
    const { getByTestId } = render(
      <Sparkline history={mkHistory([100, 110])} width={120} height={50} />
    );
    const svg = getByTestId('sparkline');
    expect(svg.getAttribute('width')).toBe('120');
    expect(svg.getAttribute('height')).toBe('50');
    expect(svg.getAttribute('viewBox')).toBe('0 0 120 50');
  });
});

describe('Sparkline — path 數學正確性', () => {
  it('起點 x=0、終點 x=width', () => {
    const { getByTestId } = render(
      <Sparkline history={mkHistory([100, 90, 80])} width={100} height={30} />
    );
    const d = getByTestId('sparkline-line').getAttribute('d') ?? '';
    // 起點：M0.0 跟某個 y
    expect(d).toMatch(/^M0\.0\s/);
    // 終點：L100.0 跟某個 y
    expect(d).toMatch(/L100\.0\s\d/);
  });

  it('終點 circle 位於 width', () => {
    const { container } = render(
      <Sparkline history={mkHistory([100, 50])} width={80} height={30} />
    );
    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('cx')).toBe('80');
  });
});
