import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseClient.js', () => ({ supabase: { auth: {} } }));
vi.mock('./HomePage.jsx', () => ({ default: () => <main data-home /> }));

// F140 (client design, owner 2026-10-13): the header keeps our sticky bar and phone menu, and takes the
// design's sub-line, links and actions.
describe('marketing header', () => {
  let html = '';
  beforeAll(async () => {
    globalThis.location = { pathname: '/', hash: '#/', search: '' };
    const { default: MarketingSite } = await import('./MarketingSite.jsx');
    html = renderToStaticMarkup(<MarketingSite onAuthed={() => {}} />);
  });
  const header = () => html.slice(html.indexOf('<header'), html.indexOf('</header>'));

  it('shows the brand with its BY NTER.PRO sub-line', () => {
    expect(header()).toMatch(/<span>TERMINAL<small>BY NTER\.PRO<\/small><\/span>/);
  });

  it('links Home, Data coverage and Pricing, in that order, with Home current', () => {
    const links = [...header().matchAll(/class="mkt-nav-link[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
    expect(links).toEqual(['Home', 'Data coverage', 'Pricing']);
    expect(header()).toMatch(/class="mkt-nav-link on" aria-current="page"[^>]*>Home/);
  });

  it('puts Sign in beside the Get started button, after the links', () => {
    const actions = header().slice(header().indexOf('mkt-nav-actions'));
    expect(actions).toMatch(/class="mkt-sign-in"[^>]*>Sign in<\/button><button[^>]*class="mkt-cta mkt-start"[^>]*>Get started<\/button>/);
    expect(header().indexOf('Data coverage')).toBeLessThan(header().indexOf('Sign in'));
  });

  it('keeps the phone menu button', () => {
    expect(header()).toMatch(/class="mkt-menu-btn" aria-label="Menu"/);
  });
});
