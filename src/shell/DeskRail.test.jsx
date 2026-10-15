// F195 (owner 2026-10-15): on module pages the desks move to a collapsible left rail; the category
// row stays on top. Collapsed it shows icons; expanded it lies over the page with names.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DeskRail, { DeskRailToggle, RailList } from './DeskRail.jsx';
import { TABS } from '../desks/catalog.js';

const SOME = TABS.filter((desk) => ['home', 'national', 'global', 'law'].includes(desk.id));
const html = (props) => renderToStaticMarkup(<DeskRail tab="national" lang="en" tabs={SOME} onDesk={() => {}} onOpenChange={() => {}} {...props} />);

describe('the desk rail', () => {
  it('lists the reader\'s desks, marks the current one and the locked ones', () => {
    const out = html({ lockedIds: new Set(['global']) });
    expect(out).toContain('<nav class="desk-rail" id="desk-rail" aria-label="Desks">');
    expect((out.match(/<li>/g) || []).length).toBe(4);
    expect((out.match(/aria-current="page"/g) || []).length).toBe(1);
    expect(out.match(/<button[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/button>/)[1]).toContain('<span class="desk-rail-name">National</span>');
    expect(out).toContain('title="Global · Upgrade"');
    expect(out).toContain('<small>Upgrade</small>');
    expect(out).not.toContain('State');
  });

  // F195 follow-up (owner 2026-10-15): the toggle moved out of the rail into the start of the
  // category row, above the rail's column, with a two-line icon that morphs into a cross when open.
  it('has no toggle of its own, and keeps every desk\'s name for screen readers', () => {
    const out = html();
    expect(out).not.toContain('desk-rail-toggle');
    expect(out).toContain('<span class="desk-rail-name">Law</span>');
    expect(out).not.toContain('desk-rail-scrim');
  });

  it('open, says so, and lays a scrim behind it for the phone drawer', () => {
    const out = html({ open: true });
    expect(out).toContain('<nav class="desk-rail open" id="desk-rail" aria-label="Desks">');
    expect(out).toContain('class="desk-rail-scrim" aria-hidden="true"');
  });

  it('is opened from a toggle that says what it does and controls the rail', () => {
    const closed = renderToStaticMarkup(<DeskRailToggle open={false} onToggle={() => {}} />);
    expect(closed).toMatch(/^<button type="button" class="desk-rail-toggle" aria-expanded="false" aria-controls="desk-rail" aria-label="Show desks" title="Show desks"><svg class="desk-rail-glyph"/);
    expect((closed.match(/<line /g) || []).length).toBe(2);
    const open = renderToStaticMarkup(<DeskRailToggle open onToggle={() => {}} />);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-label="Hide desks"');
    expect(renderToStaticMarkup(<DeskRailToggle open={false} lang="hi" onToggle={() => {}} />)).toContain('aria-label="डेस्क दिखाएँ"');
    const onToggle = vi.fn();
    DeskRailToggle({ open: false, onToggle }).props.onClick();
    expect(onToggle).toHaveBeenCalledOnce();
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
    expect(code).toMatch(/const onFocusOut = \(e\) => \{ const to = e\.relatedTarget; if \(to && !nav\.current\?\.contains\(to\) && !to\.closest\?\.\('\.desk-rail-toggle'\)\) close\(false\); \};/);
  });

  it('closes from a tap on the scrim itself, so the tap does not reach the page under it', () => {
    expect(code).toContain('<div className="desk-rail-scrim" aria-hidden="true" onClick={() => onOpenChange(false)} />');
    expect(code).toMatch(/if \(nav\.current\?\.contains\(e\.target\) \|\| e\.target\?\.closest\?\.\('\.desk-rail-toggle, \.desk-rail-scrim'\)\) return;/);
  });
});

describe('the rail\'s layout', () => {
  const css = readFileSync(new URL('./deskRail.css', import.meta.url), 'utf8');

  it('takes a 56 px column under the category row, which runs the full width with the toggle first', () => {
    expect(css).toMatch(/\.terminal\.with-module-navigation\.with-desk-rail \{[^}]*grid-template-columns: 56px minmax\(0, 1fr\);[^}]*grid-template-areas: "top top" "modules modules" "rail work";/);
    expect(css).toMatch(/\.with-desk-rail > \.desktabs > \.desk-rail-toggle \{[^}]*position: sticky; left: 0;[^}]*width: 56px;/);
  });

  it('slides open to 208 px over the page by its clip, not by its width', () => {
    expect(css).toMatch(/\.desk-rail \{[^}]*width: 208px;[^}]*clip-path: inset\(0 152px 0 0\);[^}]*transition: clip-path 220ms/);
    expect(css).toMatch(/\.desk-rail\.open \{[^}]*clip-path: inset\(0 -48px 0 0\);/);
  });

  it('morphs the toggle\'s two lines into a cross when open', () => {
    expect(css).toMatch(/\.desk-rail-toggle\[aria-expanded="true"\] \.desk-rail-glyph-top \{ transform: translateY\(3px\) rotate\(45deg\); \}/);
    expect(css).toMatch(/\.desk-rail-toggle\[aria-expanded="true"\] \.desk-rail-glyph-bottom \{ transform: translateY\(-3px\) rotate\(-45deg\); \}/);
  });

  it('becomes a drawer with a scrim at 900 px and below, opened from the same toggle', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 900px)'));
    expect(phone).toMatch(/\.desk-rail \{ display: none; \}/);
    expect(phone).toMatch(/\.desk-rail\.open \{[^}]*clip-path: none;/);
    expect(phone).toMatch(/\.desk-rail\.open \{[^}]*position: fixed;[^}]*width: min\(280px, 86vw\);/);
    expect(phone).toMatch(/\.desk-rail-scrim \{[^}]*position: fixed; inset: 0;/);

  });

  // F195 review: the header's bottom padding must outrank .with-v6-directory>.topbar, and the open
  // rail must sit above the category row (z-index 80) and below the header (200).
  it('pads the header under its controls and lifts the open rail over the category row', () => {
    expect(css).toMatch(/\.terminal\.with-desk-rail > \.topbar \{[^}]*padding-bottom: 12px;/);
    expect(css).toMatch(/\.desk-rail\.open \{[^}]*z-index: 90;/);
  });

  it('only animates opacity and transform, and not at all with reduced motion', () => {
    expect(css).not.toMatch(/transition:[^;]*width/);
    expect(css).not.toMatch(/desktabs-desks/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*animation: none;/);
  });
});
