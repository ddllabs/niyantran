import { describe, expect, it } from 'vitest';
import { COMPACT_BELOW, citedChip, fitItems, parsePageInput, toolbarLayout } from './chromeModel.js';

describe('parsePageInput', () => {
  it('accepts a whole page within 1..total, trimmed', () => {
    expect(parsePageInput('7', 22)).toBe(7);
    expect(parsePageInput(' 22 ', 22)).toBe(22);
    expect(parsePageInput('1', 1)).toBe(1);
  });

  it('rejects anything that is not a page in range', () => {
    for (const text of ['', '  ', '0', '23', '-1', '3.5', '1e1', 'abc', '07x', '+3', null, undefined]) {
      expect(parsePageInput(text, 22), String(text)).toBeNull();
    }
  });

  it('rejects when the total itself is not a page count', () => {
    expect(parsePageInput('1', 0)).toBeNull();
    expect(parsePageInput('1', Number.NaN)).toBeNull();
  });
});

describe('citedChip', () => {
  it('is a status on the cited page', () => {
    expect(citedChip({ page: 4, cited: 4 })).toEqual({ kind: 'status', label: 'Cited p. 4' });
  });

  it('is a way back to the cited page anywhere else', () => {
    expect(citedChip({ page: 9, cited: 4 })).toEqual({ kind: 'return', label: 'Back to p. 4', target: 4 });
  });
});

describe('toolbarLayout', () => {
  it('is compact below the threshold and full at or above it', () => {
    expect(toolbarLayout(COMPACT_BELOW - 1)).toBe('compact');
    expect(toolbarLayout(COMPACT_BELOW)).toBe('full');
    expect(toolbarLayout(1200)).toBe('full');
  });

  it('treats an unmeasured width as full, so the first paint does not hide zoom', () => {
    expect(toolbarLayout(0)).toBe('full');
    expect(toolbarLayout(undefined)).toBe('full');
  });
});

describe('fitItems', () => {
  it('lists the three fits and checks the current one', () => {
    expect(fitItems({ fit: 'width', manual: false })).toEqual([
      { value: 'text', label: 'Fit text', checked: false },
      { value: 'width', label: 'Fit width', checked: true },
      { value: 'page', label: 'Fit page', checked: false },
    ]);
  });

  it('checks none under a manual zoom, so picking a fit returns to it', () => {
    expect(fitItems({ fit: 'text', manual: true }).some(item => item.checked)).toBe(false);
  });
});
