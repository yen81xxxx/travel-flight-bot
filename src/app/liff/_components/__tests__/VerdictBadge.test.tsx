/**
 * VerdictBadge — 統一徽章（手冊 §4.8）
 *
 * 重點：buy = strong（實心綠 class），其餘 tinted（inline style 帶 bg）。
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render } from '@testing-library/react';
import { VerdictBadge } from '../VerdictBadge';
import type { Verdict } from '../../_types';

const mk = (verdict: Verdict) => ({ verdict });

describe('VerdictBadge', () => {
  it('buy → strong class（實心綠）+ 「建議入手」', () => {
    const { getByTestId, container } = render(<VerdictBadge intel={mk('buy')} />);
    const badge = getByTestId('verdict-badge');
    expect(badge.className).toContain('strong');
    expect(badge.getAttribute('data-verdict')).toBe('buy');
    expect(container.textContent).toContain('建議入手');
    // strong 不用 inline style（CSS class 處理）
    expect(badge.getAttribute('style')).toBeNull();
  });

  it.each([
    ['lean-buy', '可考慮'],
    ['watch', '觀察中'],
    ['wait', '建議再等']
  ] as [Verdict, string][])('%s → 非 strong + 「%s」', (verdict, label) => {
    const { getByTestId, container } = render(<VerdictBadge intel={mk(verdict)} />);
    const badge = getByTestId('verdict-badge');
    expect(badge.className).not.toContain('strong');
    expect(container.textContent).toContain(label);
    expect(badge.getAttribute('data-verdict')).toBe(verdict);
  });

  it('lean-buy / wait → tinted inline bg（rgba 留得住；watch 的 var() 會被 jsdom 過濾所以不驗）', () => {
    // lean-buy bg = rgba(100,210,255,0.14)、wait bg = rgba(255,159,10,0.14) — jsdom 保留 rgba
    // 同 test 內兩次 render 要用各自的 container 查，避免 multiple match
    const r1 = render(<VerdictBadge intel={mk('lean-buy')} />);
    expect(
      r1.container.querySelector('[data-testid="verdict-badge"]')?.getAttribute('style')
    ).toContain('rgba(100, 210, 255');
    r1.unmount();
    const r2 = render(<VerdictBadge intel={mk('wait')} />);
    expect(
      r2.container.querySelector('[data-testid="verdict-badge"]')?.getAttribute('style')
    ).toContain('rgba(255, 159, 10');
  });

  it('size="sm" → sm class', () => {
    const { getByTestId } = render(<VerdictBadge intel={mk('buy')} size="sm" />);
    expect(getByTestId('verdict-badge').className).toContain('sm');
  });

  it('預設 size=md → 無 sm class', () => {
    const { getByTestId } = render(<VerdictBadge intel={mk('buy')} />);
    expect(getByTestId('verdict-badge').className).not.toContain('sm');
  });
});
