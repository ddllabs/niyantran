// F175: the admin Website page no longer has the per-browser name, contact, search and analytics
// fields (they only changed the editing browser); the homepage intro video, stored in Supabase,
// is still managed there.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseClient.js', () => ({ supabase: {} }));

import { SiteSettingsPage } from './AdminSitePages.jsx';

describe('admin Website page (F175)', () => {
  const html = renderToStaticMarkup(<SiteSettingsPage />);

  it('has no per-browser site fields or publish and restore buttons', () => {
    for (const gone of ['Website name', 'Short name', 'Contact email', 'Registered address', 'Meta title', 'Google Analytics ID', 'Additional head script', 'Publish settings', 'Restore defaults', 'Theme colour']) {
      expect(html).not.toContain(gone);
    }
  });

  it('still has the homepage intro video controls', () => {
    for (const kept of ['Homepage walkthrough video', 'Show video section on the homepage', 'Upload video file', 'Save video settings', 'Remove uploaded file']) {
      expect(html).toContain(kept);
    }
  });

  it('says where the other site details are managed', () => {
    expect(html).toMatch(/published with the website/i);
  });
});
