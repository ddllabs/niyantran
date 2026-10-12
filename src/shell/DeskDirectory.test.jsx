import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeskDirectoryCards, DeskLandingTabs } from './DeskDirectory.jsx';
import { TABS } from '../desks/catalog.js';

describe('v6 desk directory', () => {
  it('retains persona destinations, canonical route identities and free access without a Local invention', () => {
    const tabs = TABS.filter(tab => ['home', 'national', 'global', 'state'].includes(tab.id));
    const html = renderToStaticMarkup(<DeskDirectoryCards tabs={tabs} tab="national" lockedIds={new Set(['global'])} onDesk={() => {}}/>);
    expect((html.match(/<button/g) || []).length).toBe(4);
    expect(html).not.toContain('Upgrade');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-directory="state"');
    expect(html).not.toContain('data-directory="local"');
    expect(html).not.toContain('records');
  });
  it('uses existing Hindi names and verified National reference imagery', () => {
    const html = renderToStaticMarkup(<DeskDirectoryCards tabs={TABS} tab="law" lang="hi" onDesk={() => {}}/>);
    expect(html).toContain('राष्ट्रीय');
    expect(html).toContain('विधि');
    expect(html).toContain('/images/desks-v6/a675cbad2d7f9b9d7e3b.png');
    expect((html.match(/<img src=/g) || []).length).toBe(8);
    expect(html).not.toContain('<img alt=');
  });
  // Owner, 2026-10-13: the desk icons of the former left rail (DeskRail, removed in b0ba405) return
  // beside each top desk tab, decorative only so each tab's name stays its accessible label.
  it('desk tabs show each desk\'s icon before its name, hidden from assistive technology', () => {
    const html = renderToStaticMarkup(<DeskLandingTabs tabs={TABS} tab="national" onDesk={() => {}}/>);
    expect((html.match(/<button/g) || []).length).toBe(TABS.length);
    expect((html.match(/<svg[^>]*aria-hidden="true"/g) || []).length).toBe(TABS.length);
    expect(html).toMatch(/aria-current="page"[^>]*><svg[^>]*>[\s\S]*?<\/svg><span>National<\/span><\/button>/);
  });
});

