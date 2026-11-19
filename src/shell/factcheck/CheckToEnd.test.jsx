// B7: "Check to the end": the length that covers the rest of a recorded video is preselected and marked.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckPanel } from './FactCheckPanel.jsx';
import { COVERS_REST_TEXT, coverLength } from './factCheckText.js';

describe('coverLength', () => {
  it('is the smallest offered length that covers the seconds left', () => {
    expect(coverLength(30)).toBe(1);
    expect(coverLength(60)).toBe(1);
    expect(coverLength(61)).toBe(2);
    expect(coverLength(300)).toBe(5);
    expect(coverLength(301)).toBe(10);
    expect(coverLength(1200)).toBe(20);
    expect(coverLength(1201)).toBe(30);
    expect(coverLength(1800)).toBe(30);
  });
  it('is null when more than 30 minutes are left, or the figure is unknown or unusable', () => {
    expect(coverLength(1801)).toBeNull();
    for (const bad of [null, undefined, NaN, Infinity, 0, -5, '300']) expect(coverLength(bad)).toBeNull();
  });
});

const base = {
  status: 'choosing', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null,
};
const noop = () => {};
const view = (extra = {}) => ({
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, userId: 'u' }, supported: true, ready: true,
  session: base, announcement: '', balance: 1000000, rechecks: {}, ...extra,
});
const render = (v, props = {}) => renderToStaticMarkup(
  <FactCheckPanel view={v} isMuted={false} onUnmute={noop} onConfirm={noop} onCancel={noop} onStop={noop} onRetry={noop} onDismiss={noop} {...props} />,
);
const option = (html, minutes) => html.match(new RegExp(`<button[^>]*data-minutes="${minutes}"[^>]*>.*?</button>`))[0];
const pressed = (html) => [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*data-minutes="(\d+)"|<button[^>]*data-minutes="(\d+)"[^>]*aria-pressed="true"/g)].map((m) => m[1] || m[2]);

describe('the start screen', () => {
  it('today: no figure means no hint and the usual default', () => {
    const html = render(view());
    expect(html).not.toContain(COVERS_REST_TEXT);
    expect(pressed(html)).toEqual(['5']);
  });
  it('with 7 minutes left it preselects 10 minutes, shows the hint under it only, and the price is the normal one', () => {
    const html = render(view(), { remainingSeconds: 420 });
    expect(pressed(html)).toEqual(['10']);
    expect(html.match(new RegExp(COVERS_REST_TEXT, 'g'))).toHaveLength(1);
    expect(option(html, '10')).toContain(COVERS_REST_TEXT);
    expect(option(html, '10')).toContain('5,000 credits');
    expect(html).toContain('Start 10 minutes · 5,000 credits');
  });
  it('with more than 30 minutes left there is no hint and the default stays', () => {
    const html = render(view(), { remainingSeconds: 2400 });
    expect(html).not.toContain(COVERS_REST_TEXT);
    expect(pressed(html)).toEqual(['5']);
  });
  it('a length the balance cannot pay falls back to the usual choice, with the hint still shown', () => {
    const html = render(view({ balance: 3000 }), { remainingSeconds: 1500 });
    expect(pressed(html)).toEqual(['5']);
    expect(option(html, '30')).toContain(COVERS_REST_TEXT);
  });
  it('a re-analysis keeps priority: its length is preselected and there is no hint', () => {
    const shared = { phase: 'ready', error: null, unlockCreditsPerMinute: 100, stretches: [], unlocks: {}, reports: {}, covering: null, reanalysis: { stretchId: 's', minutes: 2, fromS: 130, seek: 'ok', token: 1 } };
    const html = render(view({ flag: { available: true, creditsPerMinute: 500, recheckCredits: null, sharing: { unlockCreditsPerMinute: 100 }, userId: 'u' }, shared, shareActions: {} }), { remainingSeconds: 1500 });
    expect(pressed(html)).toEqual(['2']);
    expect(html).not.toContain(COVERS_REST_TEXT);
  });
});
