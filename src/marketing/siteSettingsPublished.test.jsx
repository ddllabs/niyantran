// F175: the public pages read the site name, contact email and address from the published values,
// not from a value one browser may have saved in localStorage.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_SETTINGS } from '../lib/siteSettings.js';
import LegalDocPage from './LegalDocPage.jsx';

const STALE = { siteName: 'EDITED SITE NAME', contactEmail: 'edited@example.test', contactAddress: 'EDITED ADDRESS', contactWebsite: 'edited.example.test', tagline: 'EDITED TAGLINE' };

// A document with no email, address or organisation of its own, so the page falls back to the site values.
const bare = () => ({
  lastUpdated: 'today', org: '', team: '', email: '', website: '', address: '',
  sections: [{ id: 'contact', num: '1', title: 'Contact', body: 'Write to us.' }],
});

describe('public pages show the published site values (F175)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('LegalDocPage ignores an edited value in this browser', () => {
    vi.stubGlobal('localStorage', { getItem: (k) => (k === 'niyantranSiteSettings' ? JSON.stringify(STALE) : null), setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, location: { origin: 'https://example.test' } });
    const html = renderToStaticMarkup(
      <LegalDocPage load={bare} subscribe={() => () => {}} title="Test" lede="Lede for {org}." />,
    );
    expect(html).not.toContain('EDITED');
    expect(html).not.toContain('edited@example.test');
    expect(html).toContain(SITE_SETTINGS.contactEmail);
    expect(html).toContain(SITE_SETTINGS.contactAddress);
    expect(html).toContain(SITE_SETTINGS.siteName);
  });
});
