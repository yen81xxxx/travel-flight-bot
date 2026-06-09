/**
 * SignalPill — render 三個 signal、color/bg/icon 來自 SIGNAL_META。
 *
 * 不重測 SIGNAL_META 本身（signal.test.ts 已涵蓋）；這裡確保 component
 * 把它正確套到 style + 把 icon 跟 sub 句正確 render。
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render } from '@testing-library/react';
import { SignalPill } from '../SignalPill';

describe('SignalPill', () => {
  it('signal=hit → 顯示「已達標」+ 副標「建議入手」', () => {
    const { getByTestId, container } = render(<SignalPill signal="hit" />);
    expect(getByTestId('signal-pill').getAttribute('data-signal')).toBe('hit');
    expect(container.textContent).toContain('已達標');
    expect(container.textContent).toContain('建議入手');
  });

  it('signal=near → 顯示「接近目標」+ 「再等等」', () => {
    const { container } = render(<SignalPill signal="near" />);
    expect(container.textContent).toContain('接近目標');
    expect(container.textContent).toContain('再等等');
  });

  it('signal=watching → 顯示「監控中」、無副標', () => {
    const { container } = render(<SignalPill signal="watching" />);
    expect(container.textContent).toContain('監控中');
    // 副標欄不存在
    expect(container.querySelector('.sub')).toBeNull();
  });

  it('icon 來自 SIGNAL_META — hit 用 target icon', () => {
    const { container } = render(<SignalPill signal="hit" />);
    expect(container.querySelector('[data-icon="target"]')).toBeInTheDocument();
  });

  it('background 套到 inline style（從 SIGNAL_META.bg 來）', () => {
    // 註：jsdom CSS 驗證會把 color: var(--ios-green) 過濾掉（var() 在 jsdom 不被認為是
    // 合法 color 值），但 rgba() bg 留得住。在實際瀏覽器 var(--...) 會正常 render，
    // 只是這層我們只能斷言 bg。
    const { getByTestId } = render(<SignalPill signal="hit" />);
    const style = getByTestId('signal-pill').getAttribute('style') ?? '';
    expect(style).toContain('rgba(48, 209, 88'); // SIGNAL_META.hit.bg
  });

  it('compact prop 加 .compact class', () => {
    const { getByTestId } = render(<SignalPill signal="hit" compact />);
    expect(getByTestId('signal-pill').className).toContain('compact');
  });
});
