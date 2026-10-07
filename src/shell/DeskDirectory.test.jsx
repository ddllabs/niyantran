import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeskDirectoryCards } from './DeskDirectory.jsx';
import { TABS } from '../desks/catalog.js';

describe('v6 desk directory', () => {
  it('retains persona destinations, canonical route identities and visible locks without a Local invention', () => {
    const tabs = TABS.filter(tab => ['home', 'national', 'global', 'state'].includes(tab.id));
    const html = renderToStaticMarkup(<DeskDirectoryCards tabs={tabs} tab="national" lockedIds={new Set(['global'])} onDesk={() => {}}/>);
    expect((html.match(/<button/g) || []).length).toBe(4);
    expect(html).toContain('Global · Upgrade');
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
});
