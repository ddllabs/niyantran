import { describe, expect, it } from 'vitest';
import { menuFocus, openFocus } from './menuModel.js';

describe('menuFocus', () => {
  it('moves down and up, wrapping at the ends', () => {
    expect(menuFocus({ key: 'ArrowDown', index: 0, count: 3 })).toBe(1);
    expect(menuFocus({ key: 'ArrowDown', index: 2, count: 3 })).toBe(0);
    expect(menuFocus({ key: 'ArrowUp', index: 0, count: 3 })).toBe(2);
    expect(menuFocus({ key: 'ArrowUp', index: 2, count: 3 })).toBe(1);
  });

  it('starts at the first or last item when nothing in the menu has focus', () => {
    expect(menuFocus({ key: 'ArrowDown', index: -1, count: 3 })).toBe(0);
    expect(menuFocus({ key: 'ArrowUp', index: -1, count: 3 })).toBe(2);
  });

  it('jumps with Home and End', () => {
    expect(menuFocus({ key: 'Home', index: 2, count: 3 })).toBe(0);
    expect(menuFocus({ key: 'End', index: 0, count: 3 })).toBe(2);
  });

  it('leaves any other key, and an empty menu, alone', () => {
    expect(menuFocus({ key: 'a', index: 0, count: 3 })).toBeNull();
    expect(menuFocus({ key: 'Enter', index: 0, count: 3 })).toBeNull();
    expect(menuFocus({ key: 'ArrowDown', index: -1, count: 0 })).toBeNull();
  });
});

describe('openFocus', () => {
  it('opens on the first item with Enter, Space or ArrowDown, and on the last with ArrowUp', () => {
    for (const key of ['Enter', ' ', 'ArrowDown']) expect(openFocus(key)).toBe('first');
    expect(openFocus('ArrowUp')).toBe('last');
  });

  it('does not open on other keys', () => {
    for (const key of ['Escape', 'Tab', 'a', 'ArrowLeft']) expect(openFocus(key)).toBeNull();
  });
});
