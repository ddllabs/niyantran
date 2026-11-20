// F366: the panel column is always there when fact-check is offered to the account. With no session it shows
// an idle state (heading, price sentence, and the start control); while the start screen is open the same
// heading and sentence sit above the existing start screen. The controller is not involved: a function of the view.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckPanel } from './FactCheckPanel.jsx';

const sessionBase = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null,
};
const view = (session = {}, extra = {}) => ({
  flag: { available: true, creditsPerMinute: 500, userId: 'u1' }, supported: true, ready: true,
  session: { ...sessionBase, ...session }, announcement: '', balance: 10000, ...extra,
});
const render = (v, props = {}) => renderToStaticMarkup(
  <FactCheckPanel view={v} persistent channelName="Aaj Tak" playable isMuted={false} onUnmute={() => {}} onConfirm={() => {}}
    onCancel={() => {}} onStop={() => {}} onRetry={() => {}} onDismiss={() => {}} onChoose={() => {}} {...props} />,
);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('persistent panel, idle', () => {
  it('is rendered with no session, names the channel and the real price', () => {
    const html = render(view());
    expect(html).toMatch(/class="fc-panel[^"]*"/);
    expect(text(html)).toContain("Check what's being said on Aaj Tak");
    expect(text(html)).toContain('500 credits a minute, held up front. Unused whole minutes are returned.');
    expect(text(html)).not.toContain('only while it runs');
  });
  it('uses the price from the flag, not a literal', () => {
    expect(text(render(view({}, { flag: { available: true, creditsPerMinute: 120, userId: 'u1' } })))).toContain('120 credits a minute, held up front.');
  });
  it('carries the start control, with the same gating as the old entry', () => {
    expect(render(view())).toMatch(/data-fc="open"/);
    expect(render(view({}, { supported: false }))).not.toMatch(/<button[^>]*data-fc="open"/);
    expect(text(render(view({}, { supported: false })))).toContain('Fact-check is available on Chrome on a computer');
    const paused = render(view(), { playable: false });
    expect(paused).not.toMatch(/data-fc="open"/);
    expect(text(paused)).toContain('Play the video to fact-check it');
  });
  it('keeps the automated-verdicts notice visible', () => {
    expect(text(render(view()))).toContain('Verdicts are automated, may be wrong');
  });
  it('is absent when the feature is not available, and without the persistent flag nothing changes', () => {
    expect(render(view({}, { flag: { available: false, creditsPerMinute: null, userId: null } }))).toBe('');
    expect(renderToStaticMarkup(<FactCheckPanel view={view()} />)).toBe('');
  });
  it('still has a panel when no video is playing yet, without a channel name', () => {
    const html = render(view({}, { ready: false }), { channelName: '' });
    expect(text(html)).toContain('Nothing is playing.');
    expect(html).not.toMatch(/data-fc="open"/);
  });
  // F382: a pasted video is named by its title on its own line, never "on <title>"; with nothing playing
  // the panel says so in one line and offers no check.
  it('names a pasted video on its own line, without "on" before the title', () => {
    const t = text(render(view(), { channelName: '“Budget speech 2026”', pasted: true, videoTitle: 'Budget speech 2026' }));
    expect(t).toContain("Check what's being said in this video");
    expect(t).toContain('Budget speech 2026');
    expect(t).not.toMatch(/being said on /);
    expect(t).toContain('500 credits a minute, held up front.');
    expect(render(view(), { channelName: 'this video', pasted: true })).toMatch(/data-fc="open"/);
  });
  it('says nothing is playing in one line, with no price sentence or start button, when no channel or video is named', () => {
    const html = render(view(), { channelName: '' });
    expect(text(html)).toContain('Nothing is playing. Choose a channel or paste a video link to fact-check it.');
    expect(text(html)).not.toContain("Check what's being said");
    expect(html).not.toMatch(/data-fc="open"/);
  });
});

describe('persistent panel, idle with a re-check message to keep', () => {
  const noticed = (extra = {}) => view({}, { recheckNotices: ['A re-check charge was applied late.'], ...extra });
  it('shows the message and still the intro, the entry button and the notice, as the button under the video did', () => {
    const html = render(noticed());
    const t = text(html);
    expect(t).toContain('A re-check charge was applied late.');
    expect(t).toContain("Check what's being said on Aaj Tak");
    expect(t).toContain('500 credits a minute, held up front.');
    expect(html).toMatch(/<button[^>]*data-fc="open"/);
    expect(html).toMatch(/data-fc="notices-dismiss"/);
    expect(t).toContain('Verdicts are automated, may be wrong');
  });
  it('keeps the entry gating and its notes', () => {
    expect(text(render(noticed({ supported: false })))).toContain('Fact-check is available on Chrome on a computer');
    const paused = render(noticed(), { playable: false });
    expect(paused).not.toMatch(/data-fc="open"/);
    expect(text(paused)).toContain('Play the video to fact-check it');
  });
  it('is unchanged outside the persistent column', () => {
    const html = renderToStaticMarkup(<FactCheckPanel view={noticed()} onStop={() => {}} />);
    expect(html).not.toMatch(/data-fc="open"|Check what/);
  });
});

describe('persistent panel, start screen open', () => {
  it('shows the heading and sentence above the existing start screen', () => {
    const html = render(view({ status: 'choosing' }));
    const t = text(html);
    expect(t).toContain("Check what's being said on Aaj Tak");
    expect(t).toContain('500 credits a minute, held up front.');
    expect(html.indexOf('fc-idle')).toBeLessThan(html.indexOf('fc-choose'));
    expect(html).toMatch(/data-fc="confirm"/);
    expect(html).toMatch(/class="fc-options"/);
    expect(t).toContain('Available credits: 10,000');
  });
  it('is unchanged for a running session', () => {
    const html = render(view({ status: 'running', secondsLeft: 90 }));
    expect(text(html)).not.toContain("Check what's being said");
    expect(html).toMatch(/data-fc="stop"/);
  });
});
