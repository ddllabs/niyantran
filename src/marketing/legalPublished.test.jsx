// F108 (F171 B5): the admin Privacy and Terms editors saved to the editing browser's localStorage
// only, so visitors always saw the defaults and the editor's own browser showed a version nobody
// else saw. The pages now show the published text in src/lib/legalPolicies.js; the editors are gone.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../lib/legalPolicies.js';
import PrivacyPage from './PrivacyPage.jsx';
import TermsPage from './TermsPage.jsx';

const edited = (doc) => JSON.stringify({ ...doc, sections: [{ id: 'x', num: '1', title: 'EDITED IN ONE BROWSER', body: 'Not published.' }] });

describe('legal pages show the published text (F108)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['Privacy', PrivacyPage, PRIVACY_POLICY],
    ['Terms', TermsPage, TERMS_OF_SERVICE],
  ])('%s ignores an edit saved in this browser', (_, Page, doc) => {
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k === 'niyantranPrivacy' || k === 'niyantranTerms' ? edited(doc) : null),
      setItem: () => {}, removeItem: () => {},
    });
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, location: { origin: 'https://example.test' } });
    const html = renderToStaticMarkup(<Page />);
    expect(html).not.toContain('EDITED IN ONE BROWSER');
    expect(html).toContain(doc.sections[0].title.replace(/&/g, '&amp;'));
  });

  it('the admin has no Privacy or Terms editor', () => {
    const app = readFileSync(new URL('../admin/AdminApp.jsx', import.meta.url), 'utf8');
    expect(app).not.toMatch(/PrivacyAdminPage|TermsAdminPage|id: 'privacy'|id: 'terms'/);
  });
});
