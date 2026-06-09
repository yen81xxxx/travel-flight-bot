/**
 * Icon snapshot + render coverage.
 *
 * 為什麼測 Icon：
 *   - PR #1 把 40+ 個 emoji 換成 Icon。每個 name 必須真的吐出 svg path。
 *   - paths 是手抄的 SVG d 字串 — 一個 typo 就 silent fail（render 空 svg）。
 *   - 之後 PR #2-4 加新 icon 時也順手覆蓋。
 *
 * 三層：
 *   1. forEach 每個 ICON_NAMES 跑一次，斷言 <svg> + 至少一個 child（避免空 svg）
 *   2. snapshot 確保 paths 不被誤改（path d 字串改一點就會炸 snapshot）
 *   3. props (size / stroke / className) 正常被套用
 */
import * as React from 'react';
import { render } from '@testing-library/react';
import { Icon, ICON_NAMES } from '../Icon';

describe('Icon — render coverage', () => {
  it.each(ICON_NAMES)('renders <svg> with non-empty children for "%s"', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('data-icon')).toBe(name);
    // 每個 icon path 至少要有一個 child element（path / circle / rect）
    expect(svg?.children.length ?? 0).toBeGreaterThan(0);
  });

  it('ICON_NAMES 不重複（防止打字錯誤）', () => {
    const set = new Set(ICON_NAMES);
    expect(set.size).toBe(ICON_NAMES.length);
  });

  it('預設 size=22 / stroke=1.8', () => {
    const { container } = render(<Icon name="airplane" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('22');
    expect(svg?.getAttribute('height')).toBe('22');
    // stroke-width 在 child path 上
    const path = svg?.querySelector('path');
    expect(path?.getAttribute('stroke-width')).toBe('1.8');
  });

  it('size / stroke prop 覆寫', () => {
    const { container } = render(<Icon name="airplane" size={32} stroke={3} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
    const path = svg?.querySelector('path');
    expect(path?.getAttribute('stroke-width')).toBe('3');
  });

  it('className 套用到 <svg>', () => {
    const { container } = render(<Icon name="bell" className="my-icon" />);
    expect(container.querySelector('svg.my-icon')).not.toBeNull();
  });

  it('aria：沒給 title 時 aria-hidden=true（裝飾性）', () => {
    const { container } = render(<Icon name="bell" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
  });

  it('aria：給 title 時當 img 處理，吐出 <title>', () => {
    const { container } = render(<Icon name="bell" title="通知" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(container.querySelector('title')?.textContent).toBe('通知');
  });
});

describe('Icon — snapshot (catches accidental path edits)', () => {
  it.each(ICON_NAMES)('snapshot "%s"', (name) => {
    const { container } = render(<Icon name={name} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
