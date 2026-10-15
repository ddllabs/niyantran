// F192: the shell wires the interface language to the document. Server rendering never runs effects,
// so this records the shell's effects and runs the language one against a stand-in document.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const effects = vi.hoisted(() => []);
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, useEffect: (fn, deps) => { effects.push({ fn, deps }); } };
});
vi.mock('../lib/userStore.js', () => ({ sessionUser: () => ({ id: 'local-shell-fixture', type: 'policy', active: true }), userTypeOf: () => ({ id: 'policy', startTab: 'national' }), clearSessionUser: vi.fn() }));
vi.mock('./SidePanel.jsx', () => ({ default: () => null, useSidePanel: () => ({ collapsed: false, aiOpen: false }) }));
vi.mock('../desks/DeskView.jsx', () => ({ default: () => null }));
vi.mock('../desks/DeskLandingView.jsx', () => ({ default: () => null }));
vi.mock('../desks/HomeDesk.jsx', () => ({ default: () => null }));
vi.mock('./OnboardingTour.jsx', () => ({ default: () => null }));
vi.mock('./CommandSearch.jsx', () => ({ default: () => null }));
vi.mock('./LiveTvModal.jsx', () => ({ default: () => null }));
const { default: TerminalShell } = await import('./TerminalShell.jsx');

describe('TerminalShell document language', () => {
  it('sets the document lang to the interface language and restores it on unmount', () => {
    vi.stubGlobal('location', { hash: '#/home' });
    renderToStaticMarkup(<TerminalShell/>);
    const langEffects = effects.filter(e => String(e.fn).includes('applyInterfaceLang'));
    expect(langEffects).toHaveLength(1);
    expect(langEffects[0].deps).toEqual(['en']);
    const root = { lang: 'xx' };
    vi.stubGlobal('document', { documentElement: root });
    const restore = langEffects[0].fn();
    expect(root.lang).toBe('en');
    restore();
    expect(root.lang).toBe('xx');
    vi.unstubAllGlobals();
  });
});
