import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const fixture = vi.hoisted(() => ({ allowed: true, user: { id: 'local-shell-fixture', type: 'policy' } }));
vi.mock('../lib/userStore.js', () => ({ sessionUser: () => ({ ...fixture.user, active: fixture.allowed }), userTypeOf: () => ({ id: 'policy', startTab: 'national' }), clearSessionUser: vi.fn() }));
vi.mock('./SidePanel.jsx', () => ({ default: () => <aside data-protected="side-panel"/>, useSidePanel: () => ({ collapsed: false, aiOpen: false }) }));
vi.mock('../desks/DeskView.jsx', () => ({ default: props => <div data-protected="workspace">{props.featureName}</div> }));
vi.mock('../desks/DeskLandingView.jsx', () => ({ default: () => <div data-protected="landing"/> }));
vi.mock('../desks/HomeDesk.jsx', () => ({ default: () => <div>Home fixture</div> }));
vi.mock('./OnboardingTour.jsx', () => ({ default: () => <div data-protected="tour"/> }));
vi.mock('./CommandSearch.jsx', () => ({ default: () => <div>Search fixture</div> }));
vi.mock('./LiveTvModal.jsx', () => ({ default: () => null }));
import TerminalShell from './TerminalShell.jsx';

beforeEach(() => { fixture.allowed = true; vi.stubGlobal('location', { hash: '#/economics/Live%20Global%20Stock%20Exchanges' }); });
describe('account-restricted canonical destinations', () => {
  it('does not mount protected workspace, side panel or tour for a denied deep link', () => {
    fixture.allowed = false;
    const html = renderToStaticMarkup(<TerminalShell/>);
    expect(html).toContain('Access restricted');
    expect(html).toContain('Economics');
    expect(html).toContain('Live Global Stock Exchanges');
    expect(html).not.toContain('data-protected=');
    expect(location.hash).toBe('#/economics/Live%20Global%20Stock%20Exchanges');
  });
  it('does not mount landing summary hooks on a denied landing URL', () => {
    fixture.allowed = false; location.hash = '#/carbon';
    const html = renderToStaticMarkup(<TerminalShell/>);
    expect(html).toContain('Access restricted');
    expect(html).not.toContain('data-protected=');
  });
  it('gates fresh render snapshots by active account without claiming mounted hydration', () => {
    expect(renderToStaticMarkup(<TerminalShell/>)).toContain('data-protected="workspace"');
    fixture.allowed = false;
    expect(renderToStaticMarkup(<TerminalShell/>)).not.toContain('data-protected=');
    fixture.allowed = true;
    expect(renderToStaticMarkup(<TerminalShell/>)).toContain('Live Global Stock Exchanges');
  });
});


describe('v6 header hierarchy', () => {
  it.each(['#/home', '#/national', '#/law'])('keeps desk navigation in the header on %s', hash => {
    location.hash = hash;
    const html = renderToStaticMarkup(<TerminalShell/>);
    const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
    expect(header).toContain('aria-label="Desks"');
    expect(html).not.toContain('class="desk-rail');
    expect(html.match(/aria-label="Desks"/g)).toHaveLength(1);
  });
  // F195 (owner 2026-10-15): inside a desk, the desks move to the left rail and the category row is
  // the only bar under the header.
  it.each(['#/national/Bill%20Passage%20Probability%20Index', '#/economics/Live%20Global%20Stock%20Exchanges'])('moves the desks to the left rail on the module page %s', hash => {
    location.hash = hash;
    const html = renderToStaticMarkup(<TerminalShell/>);
    const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
    expect(header).not.toContain('v6-landing-tabs');
    expect(html).toMatch(/<div class="terminal with-v6-directory with-module-navigation with-desk-rail theme-/);
    expect(html).toContain('<nav class="desk-rail" id="desk-rail" aria-label="Desks">');
    expect(html.match(/aria-label="Desks"/g)).toHaveLength(1);
    expect(html.indexOf('class="desk-rail"')).toBeLessThan(html.indexOf('class="desktabs'));
    expect(html).toMatch(/<nav aria-label="Desk modules" class="desktabs"><button type="button" class="desk-rail-toggle" aria-expanded="false" aria-controls="desk-rail" aria-label="Show desks"/);
    expect(html).not.toContain('desktabs-desks');
  });
  it('keeps directory, search and account controls together beside desk navigation', () => {
    location.hash = '#/national';
    const html = renderToStaticMarkup(<TerminalShell/>);
    const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
    expect(header).toContain('v6-landing-tabs');
    expect(header).toMatch(/class="shell-header-utilities"[\s\S]*v6-directory-control[\s\S]*desk-catalogue-search[\s\S]*top-actions/);
    expect(html.match(/class="v6-landing-tabs"/g)).toHaveLength(1);
  });
});


describe('meaningful header controls', () => {
  // Owner, 2026-10-13: the header is the same on every page. Landing refresh reloads the desk
  // summaries (it remounts the landing), so it is functional there too.
  it.each(['#/home', '#/national', '#/law', '#/economics/Live%20Global%20Stock%20Exchanges'])('shows All sections, search and refresh on %s', hash => {
    location.hash = hash;
    const html = renderToStaticMarkup(<TerminalShell/>);
    expect(html).toMatch(/class="shell-header-utilities"[\s\S]*v6-directory-control[\s\S]*desk-catalogue-search[\s\S]*top-actions/);
    expect(html).toMatch(/title="Refresh (feed|desk summaries)"/);
    expect(html).not.toContain('Notifications not configured');
    expect(html).toContain('aria-label="Switch to dark mode"');
  });
  it.each(['national', 'global', 'law', 'economics', 'carbon', 'sports', 'entertainment', 'state'])('labels refresh as reloading the summaries on the %s landing', desk => {
    location.hash = '#/' + desk;
    expect(renderToStaticMarkup(<TerminalShell/>)).toContain('title="Refresh desk summaries"');
  });
  it.each(['#/home', '#/economics/Live%20Global%20Stock%20Exchanges'])('keeps the feed refresh on %s', hash => {
    location.hash = hash;
    expect(renderToStaticMarkup(<TerminalShell/>)).toContain('title="Refresh feed"');
  });
});


describe('free module access', () => {
  it.each(['national', 'global', 'law', 'economics', 'carbon', 'sports', 'entertainment', 'state'])('opens %s landing for a free account without upgrade badges', desk => {
    location.hash = '#/' + desk;
    const html = renderToStaticMarkup(<TerminalShell/>);
    expect(html).toContain('data-protected="landing"');
    expect(html).not.toContain('Upgrade');
    expect(html).not.toContain('Access restricted');
  });
});

describe('Home is the default view (owner, 2026-10-13)', () => {
  it('shows no module row or "Choose a desk" prompt on Home, and keeps it inside modules', () => {
    location.hash = '#/home';
    let html = renderToStaticMarkup(<TerminalShell/>);
    expect(html).not.toContain('Choose a desk to begin');
    expect(html).not.toContain('aria-label="Desk modules"');
    expect(html).not.toContain('with-module-navigation');
    location.hash = '#/economics/Live%20Global%20Stock%20Exchanges';
    html = renderToStaticMarkup(<TerminalShell/>);
    expect(html).toContain('aria-label="Desk modules"');
    expect(html).toContain('with-module-navigation');
  });
});

// F192: the EN/HI toggle has a name that keeps its visible text and says what it does.
describe('language toggle', () => {
  it('names the toggle in English with the visible EN first', () => {
    location.hash = '#/home';
    const html = renderToStaticMarkup(<TerminalShell/>);
    expect(html).toMatch(/<button type="button" class="icon-btn" title="Switch the interface to Hindi" aria-label="EN, switch the interface to Hindi">EN<\/button>/);
  });
});
