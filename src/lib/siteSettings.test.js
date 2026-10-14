// F175 (F171 B5): the admin Website page saved the site name, contact email, address and head tags
// to the editing browser's localStorage only, so visitors never saw an edit. The values are now
// published from code (src/lib/siteSettings.js); nothing a browser has stored changes them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPANY } from './legalPolicies.js';
import { SITE_SETTINGS, loadSiteSettings } from './siteSettings.js';
import { applySiteHead, setPageTitle } from './siteHead.js';

const STALE = {
  siteName: 'EDITED SITE NAME', shortName: 'EDITED', tagline: 'Edited tagline', metaTitle: 'EDITED TITLE',
  contactEmail: 'edited@example.test', contactAddress: 'EDITED ADDRESS', contactWebsite: 'edited.example.test',
  canonicalUrl: 'https://edited.example.test/', googleAnalyticsId: 'G-EDITED1', customHeadHtml: '<script>alert(1)</script>',
  robots: 'noindex,nofollow',
};

function fakeDocument() {
  const head = [];
  const el = (tag) => {
    const attrs = {};
    return {
      tag, attrs, textContent: '', style: {},
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: (k) => attrs[k],
      hasAttribute: (k) => k in attrs,
      remove() { const i = head.indexOf(this); if (i >= 0) head.splice(i, 1); },
    };
  };
  return {
    title: '', body: null, documentElement: { lang: '' }, head: { querySelector: () => null, appendChild: (n) => head.push(n) },
    createElement: el, querySelectorAll: () => [], headNodes: head,
  };
}

describe('site settings are published from code (F175)', () => {
  let storage;
  beforeEach(() => {
    storage = { getItem: vi.fn((k) => (k === 'niyantranSiteSettings' ? JSON.stringify(STALE) : null)), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} });
    vi.stubGlobal('CSS', { escape: (s) => s });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loadSiteSettings returns the published values and ignores a stale value in this browser', () => {
    expect(loadSiteSettings()).toEqual(SITE_SETTINGS);
    expect(loadSiteSettings().siteName).not.toBe('EDITED SITE NAME');
    expect(storage.getItem).not.toHaveBeenCalledWith('niyantranSiteSettings');
  });

  it('the company facts match the published policy pages', () => {
    const s = loadSiteSettings();
    expect(s.contactEmail).toBe(COMPANY.email);
    expect(s.contactAddress).toBe(COMPANY.address);
    expect(s.author).toBeTruthy();
    expect(s.siteName).toBe(COMPANY.brand);
  });

  it('the page title and head tags come from the published values', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    setPageTitle('');
    expect(doc.title).toBe(SITE_SETTINGS.metaTitle);
    setPageTitle('Pricing');
    expect(doc.title).toBe(`Pricing · ${SITE_SETTINGS.siteName}`);
    applySiteHead();
    const text = JSON.stringify(doc.headNodes);
    expect(text).not.toContain('EDITED');
    expect(text).not.toContain('alert(1)');
    expect(text).not.toContain('G-EDITED1');
    expect(doc.headNodes.some((n) => n.attrs.name === 'robots' && n.attrs.content === SITE_SETTINGS.robots)).toBe(true);
  });

  it('exposes no function that writes settings to the browser', async () => {
    const mod = await import('./siteSettings.js');
    expect(Object.keys(mod).sort()).toEqual(['SITE_SETTINGS', 'loadSiteSettings']);
  });
});
