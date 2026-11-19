// F366 slice B: the latest-claim strip over the video.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LatestClaimStrip } from './LatestClaimStrip.jsx';

const latest = { claim: { id: 'c9', claim_en: 'The deficit fell to 4.4 percent of GDP, the lowest in a decade' }, badge: { key: 'contradicted', label: 'Contradicted', glyph: '✕' } };
const findButton = (node) => {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (Array.isArray(n)) { stack.push(...n); continue; }
    if (n?.type === 'button') return n;
    if (n?.props?.children) stack.push(n.props.children);
  }
  return null;
};

describe('LatestClaimStrip', () => {
  it('shows the verdict badge with its glyph and label, the claim and See why; it is not a live region', () => {
    const html = renderToStaticMarkup(<LatestClaimStrip latest={latest} onSee={() => {}} />);
    // The panel's own announcer (fc-sr) already speaks each verdict; a second region would say it twice.
    expect(html).not.toMatch(/aria-live|role="status"|role="alert"/);
    expect(html).toMatch(/fc-badge fc-badge--contradicted/);
    expect(html).toContain('✕');
    expect(html).toContain('Contradicted');
    expect(html).toContain('The deficit fell to 4.4 percent');
    expect(html).toMatch(/<button[^>]*data-fc="see-why"[^>]*>See why<\/button>/);
  });
  it('shows nothing without a verdict', () => {
    const html = renderToStaticMarkup(<LatestClaimStrip latest={null} onSee={() => {}} />);
    expect(html).not.toMatch(/See why|fc-badge/);
  });
  it('See why hands over the claim id', () => {
    const onSee = vi.fn();
    findButton(LatestClaimStrip({ latest, onSee })).props.onClick();
    expect(onSee).toHaveBeenCalledWith('c9');
  });
  it('its button names the claim for a screen reader', () => {
    expect(renderToStaticMarkup(<LatestClaimStrip latest={latest} onSee={() => {}} />)).toMatch(/aria-label="See why: The deficit fell/);
  });
});
