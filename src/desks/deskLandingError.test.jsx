// F159: a desk landing without its own view charts its flagship module; a failed load says so in
// plain words, not with the request's status ("feature-feed HTTP 404").
import { expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ setData: vi.fn() }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => [typeof init === 'function' ? init() : init, hooks.setData],
  useEffect: (fn) => { fn(); }, useMemo: (fn) => fn(),
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
vi.mock('../lib/featureFeed.js', () => ({ fetchFeature: vi.fn(async () => { throw new Error('feature-feed HTTP 404'); }) }));
import DeskLandingView from './DeskLandingView.jsx';

it('a failed flagship load shows plain words and keeps the reason for debugging', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const standard = DeskLandingView({ tab: 'local', label: 'Local', buckets: [] });
    standard.type(standard.props);
    await new Promise((r) => setTimeout(r, 0));
    const shown = hooks.setData.mock.calls.at(-1)[0];
    expect(shown.error).toBe('These records couldn’t load right now.');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/feature-feed HTTP 404/);
  } finally {
    warn.mockRestore();
  }
});
