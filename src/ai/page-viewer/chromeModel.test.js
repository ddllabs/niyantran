import { describe, expect, it, vi } from 'vitest';
import { COMPACT_BELOW, chromePlan, citedChip, copyText, fitItems, parsePageInput, sectionParts, toolbarLayout } from './chromeModel.js';

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

describe('copyText', () => {
  it('writes the text and reports success', async () => {
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
    await expect(copyText('bill.pdf', clipboard)).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('bill.pdf');
  });

  it('reports failure, never throws: refused, missing, or not callable', async () => {
    await expect(copyText('x', { writeText: () => Promise.reject(new Error('denied')) })).resolves.toBe(false);
    await expect(copyText('x', { writeText: () => { throw new Error('sync'); } })).resolves.toBe(false);
    await expect(copyText('x', undefined)).resolves.toBe(false);
    await expect(copyText('x', {})).resolves.toBe(false);
  });
});

describe('chromePlan', () => {
  const plan = extra => chromePlan({ available: true, view: 'pdf', compact: false, narrow: false, full: false, ...extra });

  it('side pane, PDF view: switch, zoom in the toolbar, and Full view', () => {
    expect(plan()).toEqual({ viewSwitch: true, toolbarZoom: true, moreZoom: false, expand: true });
  });

  it('a compact side pane moves zoom into the More menu', () => {
    expect(plan({ compact: true })).toEqual({ viewSwitch: true, toolbarZoom: false, moreZoom: true, expand: true });
  });

  it('the Text view has no zoom anywhere, and keeps Full view', () => {
    expect(plan({ view: 'text' })).toEqual({ viewSwitch: true, toolbarZoom: false, moreZoom: false, expand: true });
    expect(plan({ view: 'text', compact: true }).moreZoom).toBe(false);
  });

  it('no PDF: no switch and no zoom', () => {
    expect(plan({ available: false, view: 'text' })).toEqual({ viewSwitch: false, toolbarZoom: false, moreZoom: false, expand: true });
  });

  it('phones have no Full view; inside the full view, zoom is in the pill and there is no Full view', () => {
    expect(plan({ narrow: true }).expand).toBe(false);
    expect(plan({ full: true, compact: true })).toEqual({ viewSwitch: true, toolbarZoom: true, moreZoom: false, expand: false });
  });
});

describe('sectionParts', () => {
  const title = 'THE NATIONAL ANTI-DOPING (AMENDMENT) BILL, 2025';

  it('drops a heading that only repeats the title, so the note is what shows', () => {
    expect(sectionParts({ heading: title, note: 'Amendment of section 10.' }, title)).toEqual({ head: '', note: 'Amendment of section 10.', label: 'Amendment of section 10.' });
    expect(sectionParts({ heading: ' the national anti-doping  (amendment) bill, 2025 ', note: 'x' }, title).head).toBe('');
  });

  it('collapses the line breaks and runs of spaces that extracted headings carry', () => {
    expect(sectionParts({ heading: 'Chapter\n  II', note: 'Defini-\ntions  here' }, title)).toEqual({ head: 'Chapter II', note: 'Defini- tions here', label: 'Chapter II › Defini- tions here' });
  });

  it('keeps a heading that says something else', () => {
    expect(sectionParts({ heading: 'Chapter II', note: 'Definitions' }, title)).toEqual({ head: 'Chapter II', note: 'Definitions', label: 'Chapter II › Definitions' });
  });

  it('a heading alone, a note alone, or nothing', () => {
    expect(sectionParts({ heading: 'Chapter II' }, title)).toEqual({ head: '', note: 'Chapter II', label: 'Chapter II' });
    expect(sectionParts({ note: 'Definitions' }, title)).toEqual({ head: '', note: 'Definitions', label: 'Definitions' });
    expect(sectionParts(undefined, title)).toEqual({ head: '', note: '', label: '' });
    expect(sectionParts({ heading: title }, title)).toEqual({ head: '', note: '', label: '' });
  });
});
