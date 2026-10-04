import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DeskRail from './DeskRail.jsx';
import { TABS } from '../desks/catalog.js';

describe('Shared desk navigation', () => {
  it('retains the supplied persona destinations and marks the active route and locks', () => {
    const html = renderToStaticMarkup(<DeskRail tab="national" lang="en" tabs={TABS.filter(desk => ['home', 'national', 'global', 'law'].includes(desk.id))} lockedIds={new Set(['global'])} onDesk={() => {}}/>);
    expect((html.match(/<button/g) || []).length).toBe(4);
    expect((html.match(/aria-current="page"/g) || []).length).toBe(1);
    const activeButton = html.match(/<button[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/button>/)[1];
    expect(activeButton).toContain('<span>National</span>');
    expect(html).toContain('Global · Upgrade');
    expect(html).not.toContain('State');
  });
  it('uses the existing Hindi desk labels', () => {
    const html = renderToStaticMarkup(<DeskRail tab="law" lang="hi" tabs={TABS} onDesk={() => {}}/>);
    expect(html).toContain('विधि');
    expect(html).toContain('राष्ट्रीय');
  });
});
