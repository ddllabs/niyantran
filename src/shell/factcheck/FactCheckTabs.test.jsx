// F366 slice B: the roving-tabindex tab list (the pattern of the page's deck tabs) and the verdict tiles.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RovingTabs, VerdictTiles, nextTab } from './FactCheckTabs.jsx';

describe('nextTab', () => {
  const ids = ['claims', 'transcript'];
  it('moves with the arrows, wrapping, and with Home and End', () => {
    expect(nextTab(ids, 'claims', 'ArrowRight')).toBe('transcript');
    expect(nextTab(ids, 'transcript', 'ArrowRight')).toBe('claims');
    expect(nextTab(ids, 'claims', 'ArrowLeft')).toBe('transcript');
    expect(nextTab(ids, 'transcript', 'Home')).toBe('claims');
    expect(nextTab(ids, 'claims', 'End')).toBe('transcript');
  });
  it('ignores other keys', () => {
    expect(nextTab(ids, 'claims', 'Enter')).toBeNull();
    expect(nextTab(ids, 'claims', 'a')).toBeNull();
  });
});

describe('RovingTabs', () => {
  const tabs = [{ id: 'claims', label: 'Claims · 3' }, { id: 'transcript', label: 'Transcript' }];
  it('wires ids, selection and one tab stop', () => {
    const html = renderToStaticMarkup(<RovingTabs idBase="fc" label="Fact-check results" tabs={tabs} active="transcript" onChange={() => {}} />);
    expect(html).toMatch(/id="fc-tab-claims"[^>]*aria-controls="fc-panel-claims"[^>]*aria-selected="false"[^>]*tabindex="-1"|tabindex="-1"/);
    expect(html).toMatch(/id="fc-tab-transcript"/);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-selected="true"/);
  });
  it('a key press changes the tab and focuses it', () => {
    const onChange = vi.fn();
    const focus = vi.fn();
    const el = RovingTabs({ idBase: 'fc', label: 'x', tabs, active: 'claims', onChange });
    const first = el.props.children[0];
    const preventDefault = vi.fn();
    first.props.onKeyDown({ key: 'ArrowRight', preventDefault, currentTarget: { parentElement: { querySelector: (sel) => (sel === '#fc-tab-transcript' ? { focus } : null) } } });
    expect(preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('transcript');
    expect(focus).toHaveBeenCalled();
    onChange.mockClear();
    first.props.onKeyDown({ key: 'x', preventDefault, currentTarget: {} });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('VerdictTiles', () => {
  it('toggles a verdict and clears', () => {
    const onToggle = vi.fn();
    const counts = { supported: 1, contradicted: 0, partly_true: 0, no_evidence: 0, opinion: 0 };
    const el = VerdictTiles({ counts, active: ['supported'], onToggle, onClear: () => {} });
    const buttons = el.props.children.flat().filter((c) => c?.type === 'button' && c.props['data-verdict']);
    expect(buttons).toHaveLength(5);
    buttons[1].props.onClick();
    expect(onToggle).toHaveBeenCalledWith('contradicted');
    expect(buttons[0].props['aria-pressed']).toBe(true);
    expect(buttons[1].props['aria-pressed']).toBe(false);
  });
});
