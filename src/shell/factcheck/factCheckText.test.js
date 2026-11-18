// F344 T6: pure helpers behind the panel's words and the modal's wiring.
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  DELAY_SECONDS, NO_SOURCES_TEXT, blockOptions, defaultBlock, minutesText, claimBadge, confirmStart, embedVideoId, endReasonText, errorMessage, formatClock, kindTag,
  playingTarget, priceChangedText, safeSourceUrl, MINUTE_CHOICES, reanalyzeLength, seekLateText, seekPendingText, earlierAnalysisText, REANALYZE_LABEL,
} from './factCheckText.js';

describe('formatClock', () => {
  it.each([[0, '0:00'], [5, '0:05'], [65, '1:05'], [600, '10:00'], [-3, '0:00'], [Number.NaN, '0:00']])('%s -> %s', (s, out) => {
    expect(formatClock(s)).toBe(out);
  });
});

describe('blockOptions', () => {
  it('prices 1, 2, 5, 10, 15, 20 and 30 minutes and marks what the balance cannot cover', () => {
    const o = blockOptions(500, 5000);
    expect(o.map((x) => [x.minutes, x.price, x.affordable])).toEqual([[1, 500, true], [2, 1000, true], [5, 2500, true], [10, 5000, true], [15, 7500, false], [20, 10000, false], [30, 15000, false]]);
    expect(blockOptions(500, null).every((x) => x.affordable)).toBe(true);
    expect(blockOptions(0.5, 0).every((x) => !x.affordable)).toBe(true);
  });
  it('keeps fractional prices exact enough to display', () => {
    expect(blockOptions(0.5, 100).map((x) => x.price)).toEqual([0.5, 1, 2.5, 5, 7.5, 10, 15]);
  });
});

describe('minutesText', () => {
  it('is singular for one minute and plural otherwise', () => {
    expect(minutesText(1)).toBe('1 minute');
    expect(minutesText(2)).toBe('2 minutes');
    expect(minutesText(15)).toBe('15 minutes');
    expect(minutesText(30)).toBe('30 minutes');
  });
});

describe('defaultBlock', () => {
  const pick = (balance) => defaultBlock(blockOptions(500, balance))?.minutes ?? null;
  it('is 5 minutes when affordable, or when the balance is unknown', () => {
    expect(pick(10000)).toBe(5);
    expect(pick(2500)).toBe(5);
    expect(pick(null)).toBe(5);
  });
  it('is the longest affordable length below 5 otherwise', () => {
    expect(pick(2499)).toBe(2);
    expect(pick(1000)).toBe(2);
    expect(pick(999)).toBe(1);
    expect(pick(500)).toBe(1);
  });
  it('is nothing when nothing is affordable', () => {
    expect(pick(499)).toBe(null);
    expect(pick(0)).toBe(null);
  });
});

describe('DELAY_SECONDS', () => {
  it('is the measured delay, rounded up', () => {
    expect(DELAY_SECONDS).toBe(14);
  });
});

describe('safeSourceUrl', () => {
  it('allows only http and https', () => {
    expect(safeSourceUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeSourceUrl('http://a.example')).toBe('http://a.example/');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a', '//a.example', 'a.example', '', null, 5]) expect(safeSourceUrl(bad)).toBeNull();
  });
});

describe('embedVideoId', () => {
  it('reads the id from a YouTube embed url', () => {
    expect(embedVideoId('https://www.youtube-nocookie.com/embed/RJfqzUWZ0Bw?autoplay=1&mute=1')).toBe('RJfqzUWZ0Bw');
    expect(embedVideoId('https://www.youtube.com/embed/-e72F_bBcqA')).toBe('-e72F_bBcqA');
  });
  it('is null for the literal "undefined", other hosts and unparsable addresses', () => {
    for (const v of [
      'https://www.youtube-nocookie.com/embed/undefined?autoplay=1',
      'https://evil.example/embed/RJfqzUWZ0Bw',
      'https://www.youtube.com.evil.example/embed/RJfqzUWZ0Bw',
      '/embed/RJfqzUWZ0Bw',
      'javascript:/embed/RJfqzUWZ0Bw',
    ]) expect(embedVideoId(v), v).toBeNull();
    expect(embedVideoId('https://youtube.com/embed/abcDEF_-123')).toBe('abcDEF_-123');
  });
  it('is null when there is none', () => {
    for (const v of ['', null, undefined, 'https://example.com/watch?v=abc', 'https://www.youtube.com/embed/', 'https://www.youtube.com/embed/live_stream?channel=UC1']) expect(embedVideoId(v)).toBeNull();
  });
});

describe('playingTarget', () => {
  it('names what is playing: channel, mode, video; null when nothing', () => {
    expect(playingTarget('dd-news', 'live', 'abc')).toBe('dd-news|live|abc');
    expect(playingTarget('dd-news', 'live', null)).toBeNull();
  });
});

describe('playingTarget needs a channel too', () => {
  it('is null without a channel id', () => {
    expect(playingTarget('', 'live', 'abc')).toBeNull();
    expect(playingTarget(undefined, 'live', 'abc')).toBeNull();
  });
});

describe('priceChangedText', () => {
  it('names the fresh price', () => {
    expect(priceChangedText(700)).toBe('The price changed to 700 credits a minute. Review and start again.');
    expect(priceChangedText(undefined)).toBe('The price changed. Review and start again.');
  });
});

describe('confirmStart', () => {
  it('unmutes first and then confirms, when the player is muted', () => {
    const order = [];
    confirmStart({ isMuted: true, onUnmute: () => order.push('unmute'), onConfirm: (...a) => order.push(['confirm', ...a]) }, 10, 500);
    expect(order).toEqual(['unmute', ['confirm', 10, 500]]);
  });
  it('only confirms when it is not muted', () => {
    const onUnmute = vi.fn();
    const onConfirm = vi.fn();
    confirmStart({ isMuted: false, onUnmute, onConfirm }, 5, 500);
    expect(onUnmute).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith(5, 500);
  });
});

describe('F349: the no-sources state', () => {
  const err = (fail_reason) => ({ status: 'error', verdict: null, fail_reason });
  it('is its own badge, not "Check failed"', () => {
    expect(claimBadge(err('no_sources'))).toMatchObject({ key: 'no_sources', label: 'No sources found' });
  });
  it.each(['no_label', 'bad_label', 'label_conflict', null, undefined, 'something_new'])('%s stays "Check failed"', (r) => {
    expect(claimBadge(err(r))).toMatchObject({ key: 'error', label: 'Check failed' });
  });
  it('only an error status counts: a verdict with a stray fail_reason is still a verdict', () => {
    expect(claimBadge({ status: 'checked', verdict: 'supported', fail_reason: 'no_sources' })).toMatchObject({ key: 'supported' });
  });
  it('says what it means in one line', () => {
    expect(NO_SOURCES_TEXT).toBe('The check found an answer but no source to show for it, so no verdict is given.');
  });
  it('kindTag is unaffected', () => {
    expect(kindTag({ kind: 'claim' }, claimBadge(err('no_sources')))).toBeNull();
  });
});

describe('F349: why the session ended', () => {
  it('a 409 settled is "ended from another tab or window"', () => {
    expect(endReasonText('server', 'settled')).toBe('This session was ended elsewhere: from another tab or window, or after a long pause.');
  });
  it('a 409 ended says it was already over', () => {
    expect(endReasonText('server', 'ended')).toBe('This session had already ended on the server.');
  });
  it('a server end with no known detail keeps the generic text', () => {
    expect(endReasonText('server')).toBe('The server ended the session.');
    expect(endReasonText('server', null)).toBe('The server ended the session.');
    expect(endReasonText('server', 'something_new')).toBe('The server ended the session.');
  });
  it('the detail is ignored for other reasons', () => {
    expect(endReasonText('time', 'settled')).toBe('Time is up.');
    expect(endReasonText('nonsense')).toBe('The session ended.');
  });
});

describe('F349: capture error texts', () => {
  const cap = (reason) => ({ source: 'capture', reason, status: 0 });
  it('declined: says nothing was charged and what to choose in the prompt', () => {
    const m = errorMessage(cap('denied'));
    expect(m.text).toContain('declined');
    expect(m.text).toContain('Nothing was charged.');
    expect(m.text).toMatch(/This tab/);
    expect(m.text).toMatch(/tab audio/);
    expect(m.retry).toBe(true);
  });
  it('blocked by the browser is not worded as declining, and says to use Chrome on a computer', () => {
    const m = errorMessage(cap('blocked'));
    expect(m.text).not.toMatch(/declined/);
    expect(m.text).toMatch(/did not allow/);
    expect(m.text).toContain('Chrome on a computer');
    expect(m.text).toContain('Nothing was charged.');
    expect(m.retry).toBe(true);
  });
  it('unsupported: Chrome on a computer, nothing charged, no retry', () => {
    const m = errorMessage(cap('unsupported'));
    expect(m.text).toContain('Chrome on a computer');
    expect(m.text).toContain('Nothing was charged.');
    expect(m.retry).toBe(false);
  });
  it('no audio and a generic failure say what to do and that nothing was charged', () => {
    for (const r of ['no_audio', 'failed', 'something_else']) {
      const m = errorMessage(cap(r));
      expect(m.text, r).toContain('Nothing was charged.');
      expect(m.text, r).toMatch(/tab audio/);
      expect(m.retry, r).toBe(true);
    }
  });
  it('a failure while running is NOT "nothing was charged": the session had started', () => {
    const m = errorMessage({ source: 'capture', reason: 'handler', status: 0 });
    expect(m.text).not.toContain('Nothing was charged');
    expect(m.text).toMatch(/charged only for the time used/);
  });
  it('after two failures in a row it explains instead of offering the same retry again', () => {
    for (const r of ['blocked', 'failed']) {
      const m = errorMessage(cap(r), { captureFailures: 2 });
      expect(m.text, r).toMatch(/failed twice|more than once/);
      expect(m.text, r).toContain('Chrome on a computer');
      expect(m.retry, r).toBe(false);
    }
  });
  it('a user who keeps declining can still try again (that is their choice, not a fault)', () => {
    expect(errorMessage(cap('denied'), { captureFailures: 3 }).retry).toBe(true);
  });
  it('one failure is unchanged by the counter', () => {
    expect(errorMessage(cap('blocked'), { captureFailures: 1 }).retry).toBe(true);
  });
});

// F363: the length a re-analysis starts with, and its fixed sentences.
describe('reanalyzeLength', () => {
  it.each([[0.5, 1], [1, 1], [1.2, 2], [2, 2], [3, 5], [5, 5], [6, 10], [10, 10], [11, 15], [15, 15], [16, 20], [20, 20], [21, 30], [30, 30]])(
    'a stretch of %s minutes starts at %s',
    (minutes, out) => { expect(reanalyzeLength(minutes)).toBe(out); },
  );
  it('is the longest offered length when the stretch is longer than all of them', () => {
    expect(reanalyzeLength(31)).toBe(30);
    expect(reanalyzeLength(500)).toBe(30);
    expect(reanalyzeLength(Number.POSITIVE_INFINITY)).toBe(30);
  });
  it('follows the choices it is given, not a copy of the list', () => {
    expect(reanalyzeLength(3, [1, 4, 8])).toBe(4);
    expect(reanalyzeLength(9, [1, 4, 8])).toBe(8);
    expect(reanalyzeLength(3, [8, 1, 4])).toBe(4);
  });
  it('is null (no preselection) for 0, negative, NaN and non-numbers, and for no choices', () => {
    for (const v of [0, -1, -0.5, Number.NaN, null, undefined, '5', {}]) expect(reanalyzeLength(v)).toBeNull();
    expect(reanalyzeLength(3, [])).toBeNull();
    expect(reanalyzeLength(3, undefined)).toBe(5);
  });
  it('only ever returns a length that MINUTE_CHOICES holds', () => {
    for (let m = 0.1; m < 40; m += 0.37) expect(MINUTE_CHOICES).toContain(reanalyzeLength(m));
  });
});

describe('re-analysis words', () => {
  it('has the button label and the fixed sentences', () => {
    expect(REANALYZE_LABEL).toBe('Re-analyze this block');
    expect(seekLateText('02:10')).toBe('The video could not be moved. Move it to 02:10 yourself, then press Start.');
    expect(seekPendingText('02:10')).toBe('Moving the video to 02:10…');
    expect(earlierAnalysisText('16 Nov 2026')).toBe('Earlier analysis, checked on 16 Nov 2026');
    expect(earlierAnalysisText('')).toBe('Earlier analysis');
  });
});
