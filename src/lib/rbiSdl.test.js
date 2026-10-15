import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRbiPressRss, releasePageMeta, sdlReleaseKind, sdlRows } from './rbiSdl.js';
import { FEED_SCHEDULE, itemKeyFor, itemKeysFor } from '../../server/feedSchedule.mjs';
import { classifyAnswer, itemsFromRows } from '../../server/feedStore.mjs';
import { resetFeedCache, serveFeatureFeed } from '../../server/featureFeed.mjs';
import { REGISTERS, buildRegisterItems, main, mapSdlRecord, runFor } from '../../scripts/load-feed-register.mjs';
import { packReleases } from '../../scripts/fetch-rbi-sdl-releases.mjs';

/**
 * F196: SDL Auction & Borrowing Tracker. Fixtures (fetched 2026-10-15): two items of RBI's press RSS
 * (a State Government Securities auction notice and another release), a result page (prid 63048) and a
 * notice page (prid 63087), both among the four releases the shipped F20 pack names.
 */
const fixture = (name) => readFileSync(new URL(`./__fixtures__/rbi/${name}`, import.meta.url), 'utf8');

describe('SDL releases', () => {
  it('knows a notice and a result by title, and nothing else', () => {
    expect(sdlReleaseKind('Auction of State Government Securities')).toBe('notice');
    expect(sdlReleaseKind('Result of Yield/Price Based Auction of State Government Securities')).toBe('result');
    expect(sdlReleaseKind('State Government Securities - Full Auction Result')).toBe('');
    expect(sdlReleaseKind('Auction of Government of India Securities')).toBe('');
    expect(sdlReleaseKind('Underwriting Auction for sale of Government Security for ₹34,000 crore')).toBe('');
  });

  it('reads the RSS items with their release number and date', () => {
    const items = parseRbiPressRss(fixture('sdl-press-rss.xml'));
    expect(items.map((i) => [i.prid, i.date, sdlReleaseKind(i.title)])).toEqual([
      ['63814', '2026-10-15', 'notice'],
      ['63813', '2026-10-15', ''],
    ]);
  });

  it('a notice from the RSS: one row per security, re-issues named, the auction date from the text', () => {
    const [item] = parseRbiPressRss(fixture('sdl-press-rss.xml'));
    const rows = sdlRows({ kind: 'notice', prid: item.prid, date: item.date, title: item.title, html: item.description });
    const total = rows.reduce((s, r) => s + r.notified_crore, 0);
    expect(total).toBe(24400); // "an aggregate amount of ₹24,400 Crore"
    expect(rows[0]).toMatchObject({
      date: '2026-10-15', stage: 'Auction notified', state: 'Andhra Pradesh', notified_crore: 1000, reissue: true,
      security: '7.68% Andhra Pradesh SGS 2051', first_issued: '2026-07-29', auction_type: 'Price', auction_date: '2026-10-19',
      prid: '63814', source_url: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63814', feed_key: 'sdl:63814:andhra-pradesh:7-68-andhra-pradesh-sgs-2051',
    });
    // Gujarat's second line sits under Gujarat's rowspan.
    const gujarat = rows.filter((r) => r.state === 'Gujarat');
    expect(gujarat.map((r) => [r.notified_crore, r.tenor, r.auction_type])).toEqual([[1000, 'Re-issue of 7.96% Gujarat SGS 2035, issued on October 14, 2026', 'Price'], [1000, '12 years', 'Yield']]);
    expect(rows.find((r) => r.state_label === 'Jammu and Kashmir')?.state).toBe('Jammu & Kashmir');
    expect(rows.some((r) => /total/i.test(r.state))).toBe(false);
  });

  it('a result page: notified, accepted, cut-off yield, and the cut-off price of a re-issue', () => {
    const html = fixture('sdl-result-63048.html');
    const meta = releasePageMeta(html);
    expect(meta).toEqual({ date: '2026-06-30', title: 'Result of Yield/Price Based Auction of State Government Securities' });
    const rows = sdlRows({ kind: sdlReleaseKind(meta.title), prid: '63048', date: meta.date, title: meta.title, html });
    expect(rows).toHaveLength(11);
    expect(rows.reduce((s, r) => s + r.accepted_crore, 0)).toBe(13600);
    expect(rows[0]).toMatchObject({ stage: 'Auction result', state: 'Andhra Pradesh', notified_crore: 1000, accepted_crore: 1000, cutoff_yield: 7.56, tenor_years: 13, reissue: false });
    expect(rows[0].cutoff_price).toBeUndefined();
    expect(rows[1]).toMatchObject({ state: 'Andhra Pradesh', notified_crore: 1600, cutoff_price: 104.42, cutoff_yield: 7.6672, reissue: true, security: '8.07% Andhra Pradesh SGS 2051' });
    expect(rows.filter((r) => r.state === 'Telangana').map((r) => r.tenor_years)).toEqual([13, 18, 23, 29]);
  });

  it('a notice page read from the page (the backfill): 13 states, ₹21,350 crore', () => {
    const html = fixture('sdl-notice-63087.html');
    const meta = releasePageMeta(html);
    const rows = sdlRows({ kind: sdlReleaseKind(meta.title), prid: '63087', date: meta.date, title: meta.title, html });
    expect(meta.date).toBe('2026-07-03');
    expect(new Set(rows.map((r) => r.state)).size).toBe(13);
    expect(rows.reduce((s, r) => s + r.notified_crore, 0)).toBe(21350);
  });

  it('every line of a release is its own kept item in the store, with the same key on every refresh', () => {
    const html = fixture('sdl-result-63048.html');
    const rows = sdlRows({ kind: 'result', prid: '63048', date: '2026-06-30', title: 'Result', html });
    const keys = itemKeysFor(rows, 'official');
    expect(new Set(keys).size).toBe(rows.length);
    expect(keys[0]).toBe('key:sdl:63048:andhra-pradesh:13-years');
    expect(itemKeyFor(rows[0])).toBe('key:sdl:63048:andhra-pradesh:13-years');
    const { items, dropped } = itemsFromRows(rows, 'official');
    expect(items).toHaveLength(11);
    expect(dropped.duplicate).toBe(0);
    expect(items[0].published_at).toBe('2026-06-30T00:00:00.000Z');
  });

  // F196 review: a line's key is its release, state and security (or tenor), not its place in the table,
  // so a release whose table gains or loses a line keeps every other line's key.
  it('a line keeps its key when another line of the release is gone', () => {
    const html = fixture('sdl-result-63048.html');
    const rows = sdlRows({ kind: 'result', prid: '63048', date: '2026-06-30', title: 'Result', html });
    const assam = /<tr> <td align="center" valign="top">2\.<\/td> <td valign="top">Assam<\/td>[\s\S]*?<\/tr>/;
    expect(assam.test(html)).toBe(true);
    const fewer = sdlRows({ kind: 'result', prid: '63048', date: '2026-06-30', title: 'Result', html: html.replace(assam, '') });
    expect(fewer).toHaveLength(rows.length - 1);
    const before = new Map(rows.map((r) => [`${r.state}|${r.notified_crore}|${r.tenor}`, r.feed_key]));
    for (const r of fewer) expect(r.feed_key, r.title).toBe(before.get(`${r.state}|${r.notified_crore}|${r.tenor}`));
    expect(rows[1].feed_key).toBe('sdl:63048:andhra-pradesh:8-07-andhra-pradesh-sgs-2051');
    expect(rows.find((r) => r.state === 'Punjab').feed_key).toBe('sdl:63048:punjab:4-years');
    expect(new Set(rows.map((r) => r.feed_key)).size).toBe(rows.length);
  });

  it('an aggregate line ("Total", "Grand Total", "Total (A+B)") is never a state\'s line', () => {
    const html = fixture('sdl-result-63048.html');
    for (const label of ['Total', 'Grand Total', 'Total (A+B)', 'TOTAL']) {
      const rows = sdlRows({ kind: 'result', prid: '63048', date: '2026-06-30', title: 'Result', html: html.replace('<td valign="top">Total</td>', `<td valign="top">${label}</td>`) });
      expect(rows, label).toHaveLength(11);
      expect(rows.some((r) => /total/i.test(r.state)), label).toBe(false);
    }
  });

  it('an RSS date without a zone is India time, whatever the server\'s zone', () => {
    const rss = (when) => `<rss><channel><item><title>Auction of State Government Securities</title><link>https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1</link><pubDate>${when}</pubDate><description></description></item></channel></rss>`;
    const zone = process.env.TZ;
    try {
      for (const tz of ['Asia/Kolkata', 'America/Los_Angeles', 'UTC']) {
        process.env.TZ = tz;
        expect(parseRbiPressRss(rss('Thu, 15 Oct 2026 03:30:00'))[0].date, tz).toBe('2026-10-15');
        expect(parseRbiPressRss(rss('Thu, 15 Oct 2026 20:00:00'))[0].date, tz).toBe('2026-10-15');
        // A date that names its zone is read in it, then dated in India.
        expect(parseRbiPressRss(rss('Thu, 15 Oct 2026 20:00:00 GMT'))[0].date, tz).toBe('2026-10-16');
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it('the store honours only an SDL line\'s own key; any other row\'s feed_key is ignored', () => {
    const a = { title: 'One', date: '2026-10-01', source_url: 'https://example.org/a', feed_key: 'same' };
    const b = { title: 'Two', date: '2026-10-02', source_url: 'https://example.org/b', feed_key: 'same' };
    expect(itemKeyFor(a)).not.toBe(itemKeyFor(b));
    expect(itemKeyFor(a)).not.toMatch(/^key:/);
    expect(itemKeyFor({ ...a, feed_key: 'sdl:1:goa:5-years' })).toBe('key:sdl:1:goa:5-years');
  });
});

describe('SDL Auction & Borrowing Tracker: the module', () => {
  const SDL = 'state:SDL Auction & Borrowing Tracker';
  const reply = (text) => vi.fn(async (u) => ({ ok: true, status: 200, url: String(u), headers: new Headers({ 'content-type': 'application/rss+xml' }), arrayBuffer: async () => new TextEncoder().encode(text).buffer }));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('answers the auction releases among RBI\'s latest press releases, one row per security, as a live answer the store keeps', async () => {
    resetFeedCache();
    const fetch = reply(fixture('sdl-press-rss.xml'));
    vi.stubGlobal('fetch', fetch);
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'SDL Auction & Borrowing Tracker' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('https://www.rbi.org.in/pressreleases_rss.xml');
    expect(body.rows.length).toBeGreaterThan(10);
    expect(body.rows.every((r) => r.prid === '63814' && r.stage === 'Auction notified')).toBe(true);
    expect(classifyAnswer(body)).toEqual({ status: 'ok', reason: '' });
    expect(body.meta).toMatchObject({ releases: 1, checked: 2, as_of: '2026-10-15' });
    expect(FEED_SCHEDULE[SDL]).toBe('official');
  });

  it('with no auction release among them: empty, said plainly, nothing invented', async () => {
    resetFeedCache();
    const rss = fixture('sdl-press-rss.xml').replace('<![CDATA[Auction of State Government Securities]]>', '<![CDATA[Money Market Operations]]>');
    vi.stubGlobal('fetch', reply(rss));
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'SDL Auction & Borrowing Tracker' }));
    expect(body.rows).toEqual([]);
    expect(body.source.note).toMatch(/None of the latest ten releases is an SDL auction\. No records were invented/);
    expect(classifyAnswer(body).status).toBe('empty');
    // F196 review R2: the feed was read and simply had nothing new; the store keeps its history.
    expect(body.meta).toMatchObject({ nothing_new: true, checked: 2, releases: 0 });
  });

  it('an RSS with no items at all is a broken feed: a status row, never "nothing new"', async () => {
    resetFeedCache();
    vi.stubGlobal('fetch', reply('<html><body>Service unavailable</body></html>'));
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'SDL Auction & Borrowing Tracker' }));
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].status).toBe('source_status');
    expect(body.meta?.nothing_new).toBeUndefined();
    expect(classifyAnswer(body).status).toBe('failed');
  });

  it('auction releases whose tables cannot be read are not "nothing new"', async () => {
    resetFeedCache();
    // The notice's table taken out of the RSS, and its page unreadable.
    const rss = fixture('sdl-press-rss.xml').replace(/(<item>[\s\S]*?)<description>[\s\S]*?<\/description>/, '$1<description><![CDATA[<p>See the page.</p>]]></description>');
    const fetch = vi.fn(async (u) => ({ ok: true, status: 200, url: String(u), headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(/rss/.test(String(u)) ? rss : '<html>Please try again later</html>').buffer }));
    vi.stubGlobal('fetch', fetch);
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'SDL Auction & Borrowing Tracker' }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(body.rows).toEqual([]);
    expect(body.meta?.nothing_new).toBeUndefined();
  });

  it('the backfill loads as the live refresh keys the same lines, as kind official (kept, never replaced)', async () => {
    const html = fixture('sdl-result-63048.html');
    const rows = sdlRows({ kind: 'result', prid: '63048', date: '2026-06-30', title: 'Result of Yield/Price Based Auction of State Government Securities', html });
    const register = REGISTERS[SDL];
    expect(runFor(SDL)).toMatchObject({ kind: 'official', interval_minutes: 60 });
    const { items, report } = buildRegisterItems(rows, register, 'official');
    expect(report.kept).toBe(11);
    expect(new Set(items.map((i) => i.item_key))).toEqual(new Set(itemsFromRows(rows, 'official').items.map((i) => i.item_key)));
    expect(mapSdlRecord({ ...rows[0], feed_key: 'x' })).toEqual({ drop: 'bad_record' });
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    const deps = { env: {}, readJson: vi.fn(() => ({ rows, meta: {} })), makeProdRpc: vi.fn(), makeLocalRpc: vi.fn() };
    await expect(main(['--module', SDL], deps)).resolves.toBe(0);
    expect(deps.makeProdRpc).not.toHaveBeenCalled();
    expect(out.join('\n')).toMatch(/DRY RUN: state:SDL Auction & Borrowing Tracker \(official, refreshed every 60 min\)/);
  });

  it('the backfill script reads the pack\'s auction releases from their pages and lists the full-result one unread', () => {
    const pack = [
      { title: 'Auction of State Government Securities', detail_url: 'https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63087' },
      { title: 'State Government Securities - Full Auction Result', detail_url: 'https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63051' },
      { title: 'Money Market Operations', detail_url: 'https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63000' },
    ];
    expect(packReleases(pack)).toEqual([
      { prid: '63087', title: 'Auction of State Government Securities', kind: 'notice' },
      { prid: '63051', title: 'State Government Securities - Full Auction Result', kind: '' },
    ]);
  });
});
