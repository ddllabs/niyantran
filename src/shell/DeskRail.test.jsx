// F195 (owner 2026-10-15): on module pages the desks move to a collapsible left rail; the category
// row stays on top. Collapsed it shows icons; expanded it lies over the page with names.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DeskRail, { RailList } from './DeskRail.jsx';
import { TABS } from '../desks/catalog.js';

const SOME = TABS.filter((desk) => ['home', 'national', 'global', 'law'].includes(desk.id));
const html = (props) => renderToStaticMarkup(<DeskRail tab="national" lang="en" tabs={SOME} onDesk={() => {}} onOpenChange={() => {}} {...props} />);

describe('the desk rail', () => {
  it('lists the reader\'s desks after its toggle, marks the current one and the locked ones', () => {
    const out = html({ lockedIds: new Set(['global']) });
    expect(out).toContain('<nav class="desk-rail" id="desk-rail" aria-label="Desks">');
    expect((out.match(/<li>/g) || []).length).toBe(4);
    expect((out.match(/aria-current="page"/g) || []).length).toBe(1);
    expect(out.match(/<button[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/button>/)[1]).toContain('<span class="desk-rail-name">National</span>');
    expect(out).toContain('title="Global · Upgrade"');
    expect(out).toContain('<small>Upgrade</small>');
    expect(out).not.toContain('State');
  });

  it('is collapsed by default: the toggle expands it, and names stay for screen readers', () => {
    const out = html();
    expect(out).toMatch(/<button type="button" class="desk-rail-toggle" aria-expanded="false" aria-controls="desk-rail-list" aria-label="Expand the desk list" title="Expand the desk list">/);
    expect(out).toContain('<span class="desk-rail-name">Law</span>');
    expect(out).not.toContain('desk-rail-scrim');
  });

  it('expanded, says so, and lays a scrim behind it for the phone drawer', () => {
    const out = html({ open: true });
    expect(out).toContain('<nav class="desk-rail open" id="desk-rail" aria-label="Desks">');
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('aria-label="Collapse the desk list"');
    expect(out).toContain('class="desk-rail-scrim" aria-hidden="true"');
  });

  it('hands the picked desk to the rail', () => {
    const onPick = vi.fn();
    const find = (node, test) => {
      if (!node || typeof node !== 'object') return null;
      if (test(node)) return node;
      for (const child of [node.props?.children].flat(Infinity)) { const hit = find(child, test); if (hit) return hit; }
      return null;
    };
    const list = RailList({ tab: 'national', lang: 'en', tabs: SOME, lockedIds: new Set(), onPick });
    find(list, (n) => n.type === 'button' && n.props.title === 'Law').props.onClick();
    expect(onPick).toHaveBeenCalledWith('law');
  });

  it('uses the Hindi desk labels', () => {
    const out = renderToStaticMarkup(<DeskRail tab="law" lang="hi" tabs={TABS} onDesk={() => {}} onOpenChange={() => {}} />);
    expect(out).toContain('विधि');
    expect(out).toContain('aria-label="डेस्क"');
  });
});

describe('the rail\'s closing rules', () => {
  const code = readFileSync(new URL('./DeskRail.jsx', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('./TerminalShell.jsx', import.meta.url), 'utf8');

  it('closes on any change of page, however it came (back, a category, search, the credits page)', () => {
    expect(shell).toContain("const railRoute = `${tab}|${featureName || ''}|${account || ''}`;");
    expect(shell).toMatch(/if \(railSeen !== railRoute\) \{\s*setRailSeen\(railRoute\);\s*setRailOpen\(false\);\s*\}/);
  });

  it('leaves Escape to a dialog opened over it, and closes when focus leaves it', () => {
    expect(code).toMatch(/if \(e\.key !== 'Escape' \|\| e\.defaultPrevented \|\| doc\.querySelector\('dialog\[open\], \[aria-modal="true"\]'\)\) return;/);
    expect(code).toMatch(/const onFocusOut = \(e\) => \{ const to = e\.relatedTarget; if \(to && !nav\.current\?\.contains\(to\) && !to\.closest\?\.\('\.desktabs-desks'\)\) close\(false\); \};/);
  });

  it('closes from a tap on the scrim itself, so the tap does not reach the page under it', () => {
    expect(code).toContain('<div className="desk-rail-scrim" aria-hidden="true" onClick={() => onOpenChange(false)} />');
    expect(code).toMatch(/if \(nav\.current\?\.contains\(e\.target\) \|\| e\.target\?\.closest\?\.\('\.desktabs-desks, \.desk-rail-scrim'\)\) return;/);
  });
});

describe('the rail\'s layout', () => {
  const css = readFileSync(new URL('./deskRail.css', import.meta.url), 'utf8');

  it('takes a 56 px column beside the category row and the work area on module pages', () => {
    expect(css).toMatch(/\.terminal\.with-module-navigation\.with-desk-rail \{[^}]*grid-template-columns: 56px minmax\(0, 1fr\);[^}]*grid-template-areas: "top top" "rail modules" "rail work";/);
  });

  it('widens to 208 px over the page when open', () => {
    expect(css).toMatch(/\.desk-rail\.open \{[^}]*width: 208px;/);
  });

  it('becomes a drawer with a scrim at 900 px and below, opened from the Desks button', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 900px)'));
    expect(phone).toMatch(/\.desk-rail \{ display: none; \}/);
    expect(phone).toMatch(/\.desk-rail\.open \{[^}]*position: fixed;[^}]*width: min\(280px, 86vw\);/);
    expect(phone).toMatch(/\.desk-rail-scrim \{[^}]*position: fixed; inset: 0;/);
    expect(css).toMatch(/\.desktabs \.desktabs-desks \{ display: none; \}/);
    expect(phone).toMatch(/\.desktabs \.desktabs-desks \{ display: inline-flex;/);
  });

  // F195 review: the header's bottom padding must outrank .with-v6-directory>.topbar, and the open
  // rail must sit above the category row (z-index 80) and below the header (200).
  it('pads the header under its controls and lifts the open rail over the category row', () => {
    expect(css).toMatch(/\.terminal\.with-desk-rail > \.topbar \{[^}]*padding-bottom: 12px;/);
    expect(css).toMatch(/\.desk-rail\.open \{[^}]*z-index: 90;/);
  });

  it('only animates opacity and transform, and not at all with reduced motion', () => {
    expect(css).not.toMatch(/transition:[^;]*width/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*animation: none;/);
  });
});
