/**
 * PR #19 邊緣狀態 — EmptyOnboarding / SkeletonCard / LoadingState / ErrorState
 *
 * 重點：
 *   - onboarding：4 個熱門 chip 點擊回傳正確路線、主 CTA、trust note
 *   - loading：aria-busy + 3 張骨架
 *   - error：offline/一般 兩種文案、retry callback、role="alert"
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { EmptyOnboarding, POPULAR_ROUTES } from '../EmptyOnboarding';
import { SkeletonCard, LoadingState } from '../SkeletonCard';
import { ErrorState } from '../ErrorState';

describe('EmptyOnboarding', () => {
  it('render hero + 3 步驟 + 4 熱門 chips + CTA + trust note', () => {
    const { container, getByTestId } = render(
      <EmptyOnboarding onAdd={() => {}} onQuickStart={() => {}} />
    );
    expect(getByTestId('empty-onboarding')).toBeInTheDocument();
    expect(container.textContent).toContain('開始追蹤第一條航線');
    // 3 步驟
    expect(container.textContent).toContain('新增一條航線');
    expect(container.textContent).toContain('我們每天追價');
    expect(container.textContent).toContain('達標就通知你');
    // 4 熱門路線
    expect(container.textContent).toContain('台北 → 東京');
    expect(container.textContent).toContain('台北 → 札幌');
    // trust note（誠實定位）
    expect(container.textContent).toContain('不會給你沒把握的建議');
  });

  it('熱門 chip 點擊 → onQuickStart 帶正確路線', () => {
    const onQuickStart = jest.fn();
    const { getByTestId } = render(
      <EmptyOnboarding onAdd={() => {}} onQuickStart={onQuickStart} />
    );
    fireEvent.click(getByTestId('quick-start-KIX'));
    expect(onQuickStart).toHaveBeenCalledWith(
      expect.objectContaining({ o: 'TPE', d: 'KIX' })
    );
  });

  it('主 CTA → onAdd', () => {
    const onAdd = jest.fn();
    const { getByTestId } = render(
      <EmptyOnboarding onAdd={onAdd} onQuickStart={() => {}} />
    );
    fireEvent.click(getByTestId('onboarding-add'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('POPULAR_ROUTES 固定 4 條、全 TPE 出發', () => {
    expect(POPULAR_ROUTES).toHaveLength(4);
    expect(POPULAR_ROUTES.every(r => r.o === 'TPE')).toBe(true);
    expect(POPULAR_ROUTES.map(r => r.d).sort()).toEqual(['CTS', 'FUK', 'KIX', 'NRT']);
  });
});

describe('SkeletonCard / LoadingState', () => {
  it('SkeletonCard render（不 crash、有骨架元素）', () => {
    const { getByTestId } = render(<SkeletonCard />);
    expect(getByTestId('skeleton-card')).toBeInTheDocument();
  });

  it('LoadingState → aria-busy + 3 張骨架', () => {
    const { getByTestId, getAllByTestId } = render(<LoadingState />);
    expect(getByTestId('loading-state').getAttribute('aria-busy')).toBe('true');
    expect(getAllByTestId('skeleton-card')).toHaveLength(3);
  });
});

describe('ErrorState', () => {
  it('一般錯誤 → 「暫時無法載入」+ 不怪用戶文案', () => {
    const { container, getByTestId } = render(
      <ErrorState onRetry={() => {}} />
    );
    expect(getByTestId('error-state')).toBeInTheDocument();
    expect(container.textContent).toContain('暫時無法載入');
    expect(container.textContent).toContain('不是你的操作造成的');
  });

  it('offline → 離線文案', () => {
    const { container, getByTestId } = render(
      <ErrorState offline onRetry={() => {}} />
    );
    expect(getByTestId('error-state').getAttribute('data-offline')).toBe('true');
    expect(container.textContent).toContain('目前沒有網路連線');
  });

  it('role="alert"（screen reader 立即播報）', () => {
    const { getByTestId } = render(<ErrorState onRetry={() => {}} />);
    expect(getByTestId('error-state').getAttribute('role')).toBe('alert');
  });

  it('retry 按鈕 → onRetry', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(<ErrorState onRetry={onRetry} />);
    fireEvent.click(getByTestId('error-retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('信任安撫文案存在（雲端保存）', () => {
    const { container } = render(<ErrorState onRetry={() => {}} />);
    expect(container.textContent).toContain('安全儲存在雲端');
  });
});
