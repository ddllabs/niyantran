// F363: "Re-analyze this block" in the panel, from a fake view: the button on readable parts, the start
// screen opened by it (no covered banner, preselected length, the 3 second sentence), and the mark on
// an earlier analysis. With no re-analysis in the view, the panel is what it was.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { elements } from '../hookHarness.js';
import { FactCheckPanel } from './FactCheckPanel.jsx';
import { Part } from './FactCheckParts.jsx';
import { dateLabel } from './factCheckShare.js';
import { REANALYZE_LABEL, reanalyzeIntroText, seekLateText, seekPendingText } from './factCheckText.js';

const base = {
  status: 'choosing', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null,
};
const stretch = (id, over = {}) => ({
  stretch_id: id, from_s: 130, to_s: 460, minutes: 6, checked_on: '2026-11-16', claims_count: 2, access: 'own', price: 600, lines: [], claims: [], ...over,
});
const shared = (stretches, extra = {}) => ({ phase: 'ready', error: null, unlockCreditsPerMinute: 100, stretches, unlocks: {}, reports: {}, covering: null, ...extra });
const reanalysis = (over = {}) => ({ stretchId: 's1', minutes: 10, fromS: 130, seek: 'pending', token: 1, ...over });
const view = (sessionOver = {}, sh = shared([stretch('s1')]), extra = {}) => ({
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, sharing: { unlockCreditsPerMinute: 100 }, userId: 'u' },
  supported: true, ready: true, session: { ...base, ...sessionOver }, announcement: '', balance: 20000, rechecks: {}, shared: sh, ...extra,
});
const noop = () => {};
const actions = { unlockAsk: noop, unlockCancel: noop, unlockConfirm: noop, reportAsk: noop, reportCancel: noop, reportSend: noop, reanalyze: noop };
const render = (v, shareActions = actions) => renderToStaticMarkup(
  <FactCheckPanel view={{ shareActions, ...v }} isMuted={false} onUnmute={noop} onConfirm={noop} onCancel={noop} onStop={noop} onRetry={noop} onDismiss={noop} />,
);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const buttons = (html) => html.match(/<button[^>]*data-fc="reanalyze"[^>]*>/g) || [];

describe('the button', () => {
  it('is a real button on an own and an unlocked part, labelled for the part, and not on a locked one', () => {
    const html = render(view({}, shared([stretch('a', { access: 'own' }), stretch('b', { access: 'unlocked', from_s: 600, to_s: 900 }), stretch('c', { access: 'locked', from_s: 1000, to_s: 1200 })])));
    const found = buttons(html);
    expect(found).toHaveLength(2);
    expect(found.every((b) => /type="button"/.test(b))).toBe(true);
    expect(found[0]).toMatch(/data-part="a"/);
    expect(found[1]).toMatch(/data-part="b"/);
    expect(html).not.toMatch(/data-part="c"[^>]*data-fc="reanalyze"/);
    expect(text(html)).toContain(REANALYZE_LABEL);
  });

  it('is not drawn for a stretch with an unknown access, or when the page gave no action', () => {
    expect(buttons(render(view({}, shared([stretch('a', { access: 'public' })]))))).toHaveLength(0);
    expect(buttons(render(view(), { ...actions, reanalyze: undefined }))).toHaveLength(0);
  });

  it('shows where the parts list shows: choose step, ended, error; not while a session starts or runs', () => {
    for (const status of ['choosing', 'ended', 'error']) expect(buttons(render(view({ status })))).toHaveLength(1);
    for (const status of ['sharing', 'starting', 'running', 'ending']) expect(buttons(render(view({ status })))).toHaveLength(0);
  });

  it('is not drawn with sharing off in the flag, or without shared state', () => {
    const v = view();
    expect(buttons(render({ ...v, flag: { ...v.flag, sharing: null } }))).toHaveLength(0);
    expect(buttons(render({ ...v, shared: null }))).toHaveLength(0);
    expect(render({ ...v, shared: null })).not.toMatch(/Re-analy/);
  });

  it('calls the action with the part id when pressed', () => {
    const calls = [];
    const tree = Part({ stretch: stretch('s9'), open: false, onToggle: noop, balance: 1, state: undefined, actions: { reanalyze: (id) => calls.push(id) }, renderCard: noop, earlier: false });
    const found = [...elements(tree)].filter((e) => e.props?.['data-fc'] === 'reanalyze');
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('button');
    found[0].props.onClick();
    expect(calls).toEqual(['s9']);
  });
});

describe('button names', () => {
  it('each button has its own accessible name: the label and the part\'s time range', () => {
    const html = render(view({}, shared([stretch('a', { from_s: 130, to_s: 460 }), stretch('b', { from_s: 600, to_s: 900 })])));
    const names = buttons(html).map((b) => b.match(/aria-label="([^"]*)"/)?.[1]);
    expect(names).toEqual([`${REANALYZE_LABEL}, 02:10–07:40`, `${REANALYZE_LABEL}, 10:00–15:00`]);
  });
});

describe('after an error', () => {
  const err = (error, flag = {}) => {
    const v = view({ status: 'error', error });
    return render({ ...v, flag: { ...v.flag, ...flag } });
  };
  it('offers the button only where Try again is offered', () => {
    expect(buttons(err({ status: 500 }))).toHaveLength(1);
    expect(buttons(err({ source: 'capture', reason: 'denied' }))).toHaveLength(1);
  });
  it.each([
    ['a stop that could not be confirmed', { source: 'stop', status: 500 }],
    ['a start that got no answer', { source: 'start', status: 0 }],
  ])('keeps only Close after %s', (_n, error) => {
    const html = err(error);
    expect(buttons(html)).toHaveLength(0);
    expect(html).toMatch(/data-fc="dismiss"/);
    expect(html).not.toMatch(/data-fc="retry"/);
  });
  it('keeps "End that session" and no re-analyze button for an other session that is still active', () => {
    const html = err({ reason: 'already_active', status: 409, sessionId: 's-other' });
    expect(buttons(html)).toHaveLength(0);
    expect(html).toMatch(/data-fc="orphan"/);
  });
  it('no button after capture failed twice', () => {
    const v = view({ status: 'error', error: { source: 'capture', reason: 'failed' } }, shared([stretch('s1')]), { captureFailures: 2 });
    expect(buttons(render(v))).toHaveLength(0);
  });
  it('an ended session offers it only when a new session can start (a known price)', () => {
    expect(buttons(render(view({ status: 'ended' })))).toHaveLength(1);
    const v = view({ status: 'ended' });
    expect(buttons(render({ ...v, flag: { ...v.flag, creditsPerMinute: null } }))).toHaveLength(0);
  });
});

describe('the earlier-analysis mark', () => {
  const newer = stretch('new', { from_s: 100, to_s: 400, checked_on: '2026-11-18' });
  const older = stretch('old', { from_s: 150, to_s: 450, checked_on: '2026-11-10' });
  const partHtml = (html, id) => html.match(new RegExp(`<li[^>]*data-part="${id}"[\\s\\S]*?</li>`))[0];

  it('shows the newer stretch first, keeps the older one reachable, and marks only the older with its date', () => {
    const html = render(view({}, shared([newer, older])));
    expect(html.indexOf('data-part="new"')).toBeLessThan(html.indexOf('data-part="old"'));
    expect(text(partHtml(html, 'old'))).toContain(`Earlier analysis, checked on ${dateLabel('2026-11-10')}`);
    expect(text(partHtml(html, 'new'))).not.toContain('Earlier analysis');
    const oldText = text(partHtml(html, 'old'));
    expect(oldText.split(dateLabel('2026-11-10')).length - 1).toBe(1); // the date is shown once
    // the older part still has its open control and its own re-analyze button
    expect(partHtml(html, 'old')).toMatch(/class="fc-part-toggle"/);
    expect(partHtml(html, 'old')).toMatch(/data-fc="reanalyze"/);
  });

  it('marks nothing when stretches do not overlap', () => {
    expect(text(render(view({}, shared([newer, stretch('x', { from_s: 900, to_s: 1000 })]))))).not.toContain('Earlier analysis');
  });

  it('marks an older locked stretch too', () => {
    const html = render(view({}, shared([newer, { ...older, access: 'locked' }])));
    expect(text(partHtml(html, 'old'))).toContain('Earlier analysis');
  });
});

describe('the start screen opened by the button', () => {
  const opened = (r = reanalysis(), over = {}, sh = {}) => view({}, shared([stretch('s1')], { covering: 's1', reanalysis: r, ...sh }), over);

  it('skips the already-covered banner that the plain start screen shows', () => {
    const plain = view({}, shared([stretch('s1')], { covering: 's1' }));
    expect(text(render(plain))).toContain('This part is already checked');
    expect(render(plain)).not.toMatch(/data-minutes=/);
    const html = render(opened());
    expect(text(html)).not.toContain('This part is already checked');
    expect(html).toMatch(/data-minutes="10"/);
  });

  it('preselects the length and says where the block starts', () => {
    const html = render(opened(reanalysis({ minutes: 10, seek: 'ok' })));
    expect(html).toMatch(/data-minutes="10"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-minutes="5"[^>]*aria-pressed="false"/);
    expect(text(html)).toContain('Re-analyzing the block that starts at 02:10.');
    expect(html).toMatch(/data-fc="confirm"(?![^>]*disabled)[^>]*>Start 10 minutes · 5,000 credits</);
  });

  it('without a usable stretch length falls back to the ordinary default', () => {
    expect(render(opened(reanalysis({ minutes: null })))).toMatch(/data-minutes="5"[^>]*aria-pressed="true"/);
  });

  it('keeps a length the user cannot afford chosen, with the Needs line, and disables Start', () => {
    const html = render(opened(reanalysis({ minutes: 30 }), { balance: 2000 }));
    expect(html).toMatch(/data-minutes="30"[^>]*aria-pressed="true"[^>]*disabled/);
    expect(text(html)).toContain('Needs 15,000 credits; you have 2,000');
    expect(html).toMatch(/data-fc="confirm"[^>]*disabled/);
  });

  it('the plain start screen still falls back to an affordable length with Start enabled', () => {
    const html = render(view({}, shared([stretch('s1')]), { balance: 2000 }));
    expect(html).toMatch(/data-minutes="2"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-fc="confirm"(?![^>]*disabled)/);
  });

  it('has a polite status region that is always there: empty when the video is in place, "moving" while it moves', () => {
    const region = (seek) => render(opened(reanalysis({ seek }))).match(/<div[^>]*class="fc-reanalyze-status"[^>]*>[\s\S]*?<\/div>/)[0];
    for (const seek of ['pending', 'ok', 'late']) expect(region(seek)).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
    expect(text(region('ok')).trim()).toBe('');
    expect(text(region('pending'))).toContain(seekPendingText('02:10'));
  });

  it('never hides the region when it is empty (a hidden region is not announced)', () => {
    const css = readFileSync(new URL('./factCheck.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/fc-reanalyze-status:empty/);
  });

  it('says where the check starts and that the video moves again on Start', () => {
    const t = text(render(opened()));
    expect(t).toContain(reanalyzeIntroText('02:10'));
    expect(reanalyzeIntroText('02:10')).toMatch(/where the video is when audio sharing begins/);
    expect(reanalyzeIntroText('02:10')).toMatch(/moved to 02:10 again when you press Start/);
  });

  it('disables Start while the video is still moving, and enables it when ok or late', () => {
    expect(render(opened(reanalysis({ seek: 'pending' })))).toMatch(/data-fc="confirm"[^>]*disabled/);
    for (const seek of ['ok', 'late']) expect(render(opened(reanalysis({ seek })))).toMatch(/data-fc="confirm"(?![^>]*disabled)/);
  });

  it('asks the user to move the video when the seek is late, and Start stays available', () => {
    const html = render(opened(reanalysis({ seek: 'late' })));
    const region = html.match(/<div[^>]*class="fc-reanalyze-status"[\s\S]*?<\/div>/)[0];
    expect(region).toMatch(/role="status"/);
    expect(text(region)).toContain(seekLateText('02:10'));
    expect(html).toMatch(/data-fc="confirm"(?![^>]*disabled)/);
  });

  it('does not show the re-analysis start screen with sharing off in the flag', () => {
    const v = opened();
    const html = render({ ...v, flag: { ...v.flag, sharing: null } });
    expect(text(html)).not.toContain('Re-analyzing');
    expect(html).not.toContain('fc-reanalyze');
  });
});
