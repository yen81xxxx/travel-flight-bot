/**
 * BottomSheet — open/close lifecycle + ESC + backdrop + body scroll lock
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { BottomSheet } from '../BottomSheet';

describe('BottomSheet', () => {
  it('open=false → data-open=false, aria-hidden=true', () => {
    const { getByTestId } = render(
      <BottomSheet open={false} onClose={() => {}}><div>X</div></BottomSheet>
    );
    const portal = getByTestId('bottom-sheet');
    expect(portal.getAttribute('data-open')).toBe('false');
    expect(portal.getAttribute('aria-hidden')).toBe('true');
  });

  it('open=true → data-open=true, aria-hidden=false', () => {
    const { getByTestId } = render(
      <BottomSheet open={true} onClose={() => {}}><div>X</div></BottomSheet>
    );
    const portal = getByTestId('bottom-sheet');
    expect(portal.getAttribute('data-open')).toBe('true');
    expect(portal.getAttribute('aria-hidden')).toBe('false');
  });

  it('backdrop 點擊 → onClose', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <BottomSheet open={true} onClose={onClose}><div>X</div></BottomSheet>
    );
    fireEvent.click(getByTestId('sheet-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('ESC 鍵 → onClose（open=true 時）', () => {
    const onClose = jest.fn();
    render(<BottomSheet open={true} onClose={onClose}><div>X</div></BottomSheet>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('ESC 鍵 → 不 onClose（open=false 時）', () => {
    const onClose = jest.fn();
    render(<BottomSheet open={false} onClose={onClose}><div>X</div></BottomSheet>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('開啟時 body overflow=hidden（避免背景滾）', () => {
    const { rerender, unmount } = render(
      <BottomSheet open={false} onClose={() => {}}><div>X</div></BottomSheet>
    );
    expect(document.body.style.overflow).not.toBe('hidden');
    rerender(<BottomSheet open={true} onClose={() => {}}><div>X</div></BottomSheet>);
    expect(document.body.style.overflow).toBe('hidden');
    // unmount 後復原（避免測試 leak 影響後續）
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('title prop render 在 header', () => {
    const { container } = render(
      <BottomSheet open={true} onClose={() => {}} title="標題A"><div /></BottomSheet>
    );
    expect(container.textContent).toContain('標題A');
  });

  it('subtitle 顯示在副標位', () => {
    const { container } = render(
      <BottomSheet open={true} onClose={() => {}} title="標題" subtitle="子標 X">
        <div />
      </BottomSheet>
    );
    expect(container.textContent).toContain('子標 X');
  });

  it('headerRight prop 出現在 close 鈕旁', () => {
    const { container } = render(
      <BottomSheet open={true} onClose={() => {}} title="" headerRight={<span>ACT</span>}>
        <div />
      </BottomSheet>
    );
    expect(container.textContent).toContain('ACT');
  });
});
