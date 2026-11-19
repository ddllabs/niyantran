// Review 8: the ended panel's Export names the session's day (not the day of pressing it) and its title.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
const { PanelBody } = await import('./FactCheckPanel.jsx');
const { ExportButton } = await import('./ClaimExport.jsx');

const noop = () => {};
const claim = (id, checkedAt) => ({ id, claim_en: `Claim ${id}`, kind: 'claim', status: 'checked', verdict: 'supported', reason: 'r', sources: [], checked_at: checkedAt });
const view = (session = {}) => ({
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, userId: 'u' }, supported: true, ready: true, announcement: '', balance: 1000, rechecks: {},
  session: {
    status: 'ended', endReason: 'time', minutesBought: 5, secondsLeft: 0, creditsHeld: 2500, creditsPerMinute: 500, transcript: [],
    claims: [claim('1', '2026-11-18T12:30:00Z'), claim('2', '2026-11-18T12:10:00Z')], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false,
    final: { minutes_used: 3 }, error: null, ...session,
  },
});
const props = (v, extra = {}) => ({ view: v, isMuted: false, onUnmute: noop, onConfirm: noop, onCancel: noop, onStop: noop, onRetry: noop, onDismiss: noop, channelName: 'DD News', ...extra });
const exportBuild = (out) => [...elements(out)].find((e) => e.type === ExportButton).props.build();

beforeEach(() => { harness.reset(); });

describe('the ended panel Export', () => {
  it('is dated with the day of the session (its earliest check), not the day it is pressed', () => {
    const { name, text } = exportBuild(harness.render(PanelBody, props(view())));
    expect(name).toBe('fact-check-DD-News-2026-11-18.txt');
    expect(text).toContain('Date: 2026-11-18');
    expect(text).toContain('Minutes used: 3');
    expect(text.indexOf('1. Claim 1')).toBeLessThan(text.indexOf('2. Claim 2')); // session order
  });
  it('uses the start the session reports when it reports one', () => {
    const { name } = exportBuild(harness.render(PanelBody, props(view({ startedAt: Date.parse('2026-11-17T12:00:00Z') }))));
    expect(name).toBe('fact-check-DD-News-2026-11-17.txt');
  });
  it('falls back to the day of the export when nothing says when the session was', () => {
    const v = view({ claims: [claim('1', null)] });
    const { text } = exportBuild(harness.render(PanelBody, props(v)));
    const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(text).toContain(`Date: ${today}`);
  });
  it('uses the video title when the page gives one', () => {
    const { name } = exportBuild(harness.render(PanelBody, props(view(), { videoTitle: 'Budget debate' })));
    expect(name).toBe('fact-check-Budget-debate-2026-11-18.txt');
  });
});
