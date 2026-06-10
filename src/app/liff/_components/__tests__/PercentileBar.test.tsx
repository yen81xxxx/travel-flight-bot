/**
 * PercentileBar — marker 位置 + compact prop
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render } from '@testing-library/react';
import { PercentileBar } from '../PercentileBar';

describe('PercentileBar', () => {
  it('percentile=1 (最便宜) → marker 在最右 (99%)', () => {
    const { container } = render(<PercentileBar percentile={1} />);
    const marker = container.querySelector('.p-marker') as HTMLElement;
    expect(marker.style.left).toBe('99%');
  });

  it('percentile=99 (最貴) → marker 在最左 (1%)', () => {
    const { container } = render(<PercentileBar percentile={99} />);
    const marker = container.querySelector('.p-marker') as HTMLElement;
    expect(marker.style.left).toBe('1%');
  });

  it('percentile=50 → marker 中間', () => {
    const { container } = render(<PercentileBar percentile={50} />);
    const marker = container.querySelector('.p-marker') as HTMLElement;
    expect(marker.style.left).toBe('50%');
  });

  it('非 compact → 顯示「便宜 / 第 N 百分位 / 貴」labels', () => {
    const { container } = render(<PercentileBar percentile={20} />);
    expect(container.textContent).toContain('便宜');
    expect(container.textContent).toContain('貴');
    expect(container.textContent).toContain('第 20 百分位');
  });

  it('compact → 不顯示 labels', () => {
    const { container } = render(<PercentileBar percentile={50} compact />);
    expect(container.textContent).not.toContain('便宜');
    expect(container.querySelector('.p-labels')).toBeNull();
  });

  it('data-percentile 屬性帶到 root（debug 用）', () => {
    const { getByTestId } = render(<PercentileBar percentile={42} />);
    expect(getByTestId('percentile-bar').getAttribute('data-percentile')).toBe('42');
  });
});
