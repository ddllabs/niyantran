// B2: where the transcript controls appear (static markup of the panel and of a readable shared part).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckPanel } from './FactCheckPanel.jsx';

const base = {
  status: 'running', sessionId: 's', minutesBought: 5, creditsPerMinute: 500, creditsHeld: 2500, secondsLeft: 200,
  transcript: [{ seq: 0, text: 'Good evening', startMs: 0 }, { seq: 1, text: 'GDP grew', startMs: 12000 }], claims: [],
  silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null,
};
const noop = () => {};
const stretch = (over = {}) => ({
  stretch_id: 'p1', from_s: 0, to_s: 300, minutes: 5, checked_on: '2026-11-16', claims_count: 0, access: 'own', price: 0,
  lines: [{ pos_start_s: 5, text: 'first words' }], claims: [], ...over,
});
const view = (session = {}, shared = null) => ({
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, sharing: shared ? { unlockCreditsPerMinute: 100 } : null, userId: 'u' },
  supported: true, ready: true, session: { ...base, ...session }, announcement: '', balance: 1000, rechecks: {}, shareActions: {},
  ...(shared ? { shared: { phase: 'ready', error: null, unlockCreditsPerMinute: 100, stretches: shared, unlocks: {}, reports: {}, covering: null } } : {}),
});
const render = (v) => renderToStaticMarkup(
  <FactCheckPanel view={v} isMuted={false} onUnmute={noop} onConfirm={noop} onCancel={noop} onStop={noop} onRetry={noop} onDismiss={noop} />,
);

describe('the Transcript tab', () => {
  it('has the search box, Copy and Download beside the transcript while it runs', () => {
    const html = render(view());
    const tab = html.slice(html.indexOf('id="fc-panel-transcript"'));
    expect(tab).toContain('aria-label="Search the transcript"');
    expect(tab).toContain('data-fc="tcopy"');
    expect(tab).toContain('data-fc="tdownload"');
    expect(html.slice(0, html.indexOf('id="fc-panel-transcript"'))).not.toContain('data-fc="tcopy"');
  });
  it('and after it ended', () => {
    expect(render(view({ status: 'ended', endReason: 'time' }))).toContain('data-fc="tcopy"');
  });
  it('has no controls when there is no transcript text yet', () => {
    expect(render(view({ transcript: [] }))).not.toContain('data-fc="tcopy"');
  });
});

describe('a readable part of a recorded video', () => {
  it('has the same controls above its lines', () => {
    const html = render(view({ status: 'choosing', transcript: [] }, [stretch()]));
    expect(html).toContain('data-fc="tcopy"');
    expect(html.indexOf('data-fc="tcopy"')).toBeLessThan(html.indexOf('first words'));
  });
  it('a locked part has none and shows no text', () => {
    const html = render(view({ status: 'choosing', transcript: [] }, [stretch({ access: 'locked', lines: [{ pos_start_s: 5, text: 'secret words' }] })]));
    expect(html).not.toContain('data-fc="tcopy"');
    expect(html).not.toContain('secret words');
  });
});
