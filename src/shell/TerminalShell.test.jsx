import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const fixture = vi.hoisted(() => ({ allowed: true, user: { id: 'local-shell-fixture', type: 'policy' } }));
vi.mock('../lib/userStore.js', () => ({ sessionUser: () => fixture.user, userTypeOf: () => ({ id: 'policy', startTab: 'national' }), clearSessionUser: vi.fn() }));
vi.mock('../lib/planEntitlements.js', async importOriginal => ({ ...(await importOriginal()), canAccessDesk: (_user, tab) => tab === 'home' || fixture.allowed, deskLocked: (_user, tab) => tab !== 'home' && !fixture.allowed }));
vi.mock('./SidePanel.jsx', () => ({ default: () => <aside data-protected="side-panel"/>, useSidePanel: () => ({ collapsed: false, aiOpen: false }) }));
vi.mock('../desks/DeskView.jsx', () => ({ default: props => <div data-protected="workspace">{props.featureName}</div> }));
vi.mock('../desks/DeskLandingView.jsx', () => ({ default: () => <div data-protected="landing"/> }));
vi.mock('../desks/HomeDesk.jsx', () => ({ default: () => <div>Home fixture</div> }));
vi.mock('./OnboardingTour.jsx', () => ({ default: () => <div data-protected="tour"/> }));
vi.mock('./CommandSearch.jsx', () => ({ default: () => <div>Search fixture</div> }));
vi.mock('./LiveTvModal.jsx', () => ({ default: () => null }));
vi.mock('./UpgradeModal.jsx', () => ({ default: () => null }));
import TerminalShell from './TerminalShell.jsx';

beforeEach(() => { fixture.allowed = true; vi.stubGlobal('location', { hash: '#/economics/Live%20Global%20Stock%20Exchanges' }); });
describe('restricted canonical destinations', () => {
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
  it('gates fresh render snapshots by current entitlement without claiming mounted hydration', () => {
    expect(renderToStaticMarkup(<TerminalShell/>)).toContain('data-protected="workspace"');
    fixture.allowed = false;
    expect(renderToStaticMarkup(<TerminalShell/>)).not.toContain('data-protected=');
    fixture.allowed = true;
    expect(renderToStaticMarkup(<TerminalShell/>)).toContain('Live Global Stock Exchanges');
  });
});


describe('v6 header hierarchy', () => {
  it('keeps directory, search and account controls together beside desk navigation', () => {
    location.hash = '#/national';
    const html = renderToStaticMarkup(<TerminalShell/>);
    const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
    expect(header).toContain('v6-landing-tabs');
    expect(header).toMatch(/class="shell-header-utilities"[\s\S]*v6-directory-control[\s\S]*desk-catalogue-search[\s\S]*top-actions/);
    expect(html.match(/class="v6-landing-tabs"/g)).toHaveLength(1);
  });
});
