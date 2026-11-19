// B3: the Summary tab as markup, and its place among the tabs.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SummaryTab } from './SummaryTab.jsx';

const c = (id, status, verdict = null, extra = {}) => ({ id, status, verdict, claim_en: `Claim ${id}`, ...extra });
const ctx = { rechecks: {}, price: null };
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const claims = [c('1', 'checked', 'supported'), c('2', 'checked', 'contradicted'), c('3', 'checked', 'partly_true'), c('4', 'not_checkable'), c('5', 'unchecked')];

describe('SummaryTab', () => {
  it('says "No claims yet." for an empty session and draws no bar', () => {
    const html = renderToStaticMarkup(<SummaryTab claims={[]} ctx={ctx} onSee={() => {}} />);
    expect(text(html)).toContain('No claims yet.');
    expect(html).not.toContain('fc-sum-bar');
  });
  it('has the totals sentence and a labelled list of the five verdicts with glyph, label and count', () => {
    const html = renderToStaticMarkup(<SummaryTab claims={claims} ctx={ctx} onSee={() => {}} />);
    expect(text(html)).toContain('5 claims in this session: 3 with a verdict, 1 not checkable, 1 not checked');
    expect(html).toMatch(/<ul[^>]*aria-label="Verdicts"/);
    for (const label of ['Supported', 'Contradicted', 'Partly true', 'No evidence found', 'Opinion']) expect(html).toContain(label);
    expect(html.match(/<li class="fc-sum-item/g)).toHaveLength(5);
    expect(html).toMatch(/fc-sum-item fc-sum-item--supported[^>]*>.*?✓.*?Supported.*?<b[^>]*>1</s);
  });
  it('lists Contradicted before Partly true, each with a button to the card', () => {
    const html = renderToStaticMarkup(<SummaryTab claims={claims} ctx={ctx} onSee={() => {}} />);
    expect(html.indexOf('Claim 2')).toBeGreaterThan(-1);
    expect(html.indexOf('Claim 2')).toBeLessThan(html.indexOf('Claim 3'));
    expect(html.match(/data-fc="sum-see"/g)).toHaveLength(2);
    expect(html).not.toContain('Claim 1<');
  });
  it('the button asks for that claim', () => {
    const onSee = vi.fn();
    const el = SummaryTab({ claims, ctx, onSee });
    const flat = JSON.stringify(el, (k, v) => (typeof v === 'function' ? '__fn__' : v));
    expect(flat).toContain('sum-see');
    // find the button element and click
    const walk = (n, out = []) => { if (Array.isArray(n)) n.forEach((x) => walk(x, out)); else if (n && n.props) { out.push(n); walk(n.props.children, out); } return out; };
    const btns = walk(el).filter((n) => n.props['data-fc'] === 'sum-see');
    btns[0].props.onClick();
    expect(onSee).toHaveBeenCalledWith('2');
  });
  it('invents nothing: with no contradicted or partly true claim there is no list', () => {
    const html = renderToStaticMarkup(<SummaryTab claims={[c('1', 'checked', 'supported')]} ctx={ctx} onSee={() => {}} />);
    expect(html).not.toContain('sum-see');
  });
});
