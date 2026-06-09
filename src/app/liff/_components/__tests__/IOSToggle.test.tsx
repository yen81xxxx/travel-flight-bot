/**
 * IOSToggle — render coverage + onChange 行為 + disabled
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { IOSToggle } from '../IOSToggle';

describe('IOSToggle', () => {
  it('on=true → data-on=true', () => {
    const { getByTestId } = render(<IOSToggle on={true} onChange={() => {}} />);
    expect(getByTestId('ios-toggle').getAttribute('data-on')).toBe('true');
  });

  it('on=false → data-on=false', () => {
    const { getByTestId } = render(<IOSToggle on={false} onChange={() => {}} />);
    expect(getByTestId('ios-toggle').getAttribute('data-on')).toBe('false');
  });

  it('aria-checked 跟 on 同步', () => {
    const { getByTestId, rerender } = render(<IOSToggle on={false} onChange={() => {}} />);
    expect(getByTestId('ios-toggle').getAttribute('aria-checked')).toBe('false');
    rerender(<IOSToggle on={true} onChange={() => {}} />);
    expect(getByTestId('ios-toggle').getAttribute('aria-checked')).toBe('true');
  });

  it('點擊 → 把相反值傳回去 onChange', () => {
    const handler = jest.fn();
    const { getByTestId } = render(<IOSToggle on={false} onChange={handler} />);
    fireEvent.click(getByTestId('ios-toggle'));
    expect(handler).toHaveBeenCalledWith(true);
  });

  it('on=true 時點擊 → onChange(false)', () => {
    const handler = jest.fn();
    const { getByTestId } = render(<IOSToggle on={true} onChange={handler} />);
    fireEvent.click(getByTestId('ios-toggle'));
    expect(handler).toHaveBeenCalledWith(false);
  });

  it('disabled → 不觸發 onChange', () => {
    const handler = jest.fn();
    const { getByTestId } = render(<IOSToggle on={false} onChange={handler} disabled />);
    fireEvent.click(getByTestId('ios-toggle'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('ariaLabel 套到 aria-label', () => {
    const { getByTestId } = render(<IOSToggle on={false} onChange={() => {}} ariaLabel="暫停追蹤" />);
    expect(getByTestId('ios-toggle').getAttribute('aria-label')).toBe('暫停追蹤');
  });
});
