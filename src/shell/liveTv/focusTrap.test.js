import { describe, expect, it, vi } from 'vitest';
import { trapTab } from './focusTrap.js';

function dialog(active) {
  const a = { focus: vi.fn() }; const b = { focus: vi.fn() }; const c = { focus: vi.fn() };
  const container = { querySelectorAll: () => [a, b, c], ownerDocument: { activeElement: { a, b, c }[active] || null } };
  return { container, a, b, c };
}
const key = (over = {}) => ({ key: 'Tab', shiftKey: false, preventDefault: vi.fn(), ...over });

describe('trapTab', () => {
  it('wraps from the last control to the first', () => {
    const { container, a } = dialog('c');
    const e = key();
    expect(trapTab(e, container)).toBe(true);
    expect(a.focus).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });
  it('wraps from the first control to the last with Shift', () => {
    const { container, c } = dialog('a');
    expect(trapTab(key({ shiftKey: true }), container)).toBe(true);
    expect(c.focus).toHaveBeenCalled();
  });
  it('leaves Tab alone in the middle', () => {
    const { container, a, c } = dialog('b');
    const e = key();
    expect(trapTab(e, container)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(a.focus).not.toHaveBeenCalled();
    expect(c.focus).not.toHaveBeenCalled();
  });
  it('brings focus from outside into the dialog', () => {
    const { container, a, c } = dialog(null);
    expect(trapTab(key(), container)).toBe(true);
    expect(a.focus).toHaveBeenCalled();
    expect(trapTab(key({ shiftKey: true }), container)).toBe(true);
    expect(c.focus).toHaveBeenCalled();
  });
  it('ignores other keys and a missing container, and holds focus when there is nothing to focus', () => {
    expect(trapTab(key({ key: 'a' }), dialog('a').container)).toBe(false);
    expect(trapTab(key(), null)).toBe(false);
    const e = key();
    expect(trapTab(e, { querySelectorAll: () => [], ownerDocument: {} })).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
  });
});
