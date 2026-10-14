import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCabinetDecision } from './parliament.js';

/**
 * F169 T2. Measured 2026-10-14: PIB's English press RSS answers 302 to the Hindi feed
 * (`Lang=2&reg=48`) unless the address carries `reg=3`, which returns the English feed. AI & the Tech
 * Industry showed every PIB release (the Navy, Ayurveda) when the feed did answer; it now keeps
 * technology releases and adds a technology news search. Cabinet Decisions counts a release titled
 * "Cabinet approves…" or "Cabinet apprises…" on pib.gov.in even when PIB files it under a ministry.
 */
const rss = (items) =>
  `<?xml version="1.0"?><rss><channel>${items
    .map(([t, link, date = 'Tue, 14 Oct 2026 10:00:00 GMT']) => `<item><title>${t}</title><link>${link}</link><pubDate>${date}</pubDate></item>`)
    .join('')}</channel></rss>`;

function stub(routes) {
  const seen = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    seen.push(u);
    const hit = routes.find(([re]) => re.test(u));
    const body = hit ? hit[1] : null;
    if (body == null) return { ok: false, status: 404, url: u, headers: new Headers(), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      url: u,
      headers: new Headers({ 'content-type': /<rss/.test(body) ? 'application/rss+xml' : 'text/html' }),
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    };
  }));
  return seen;
}

const HINDI_RSS = rss([['केंद्रीय मंत्री ने कार्यक्रम का शुभारंभ किया', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=900']]);

async function feed(tier, feature) {
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier, feature }));
}

describe('PIB English feed (F169 T2)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('AI & the Tech Industry asks PIB for the English region and keeps technology releases only', async () => {
    const seen = stub([
      [/RssMain\.aspx.*reg=3/i, rss([
        ['IndiaAI Mission opens its compute portal to startups', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=101'],
        ['INDIAN NAVY COMPLETES MAIDEN COMMAND OF COMBINED TASK FORCE 154', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=102'],
        ['MeitY notifies the semiconductor design incentive scheme', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=103'],
      ])],
      [/RssMain\.aspx/i, HINDI_RSS],
      [/news\.google\.com/i, rss([['Indian AI startups raise record funding this quarter - Example Times', 'https://example.com/ai-funding']])],
    ]);
    const out = await feed('finance', 'AI & the Tech Industry');
    const titles = out.rows.map((r) => r.title);
    expect(titles).toContain('IndiaAI Mission opens its compute portal to startups');
    expect(titles).toContain('MeitY notifies the semiconductor design incentive scheme');
    expect(titles.some((t) => /AI startups raise record funding/.test(t))).toBe(true);
    expect(titles.some((t) => /NAVY/i.test(t))).toBe(false);
    expect(seen.filter((u) => /RssMain/i.test(u)).every((u) => /reg=3/.test(u))).toBe(true);
  });

  it('every PIB RSS address the server asks for carries reg=3', async () => {
    const seen = stub([
      [/RssMain\.aspx.*reg=3/i, rss([['Cabinet approves the Example Scheme', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=201']])],
      [/RssMain\.aspx/i, HINDI_RSS],
    ]);
    await feed('national', 'Cabinet Decisions');
    await feed('national', 'Policy Pipeline Tracker');
    const pib = seen.filter((u) => /RssMain/i.test(u));
    expect(pib.length).toBeGreaterThan(0);
    for (const u of pib) expect(u, u).toMatch(/reg=3/);
  });
});

describe('isCabinetDecision (owner rule, 2026-10-14)', () => {
  const pib = 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=1';

  it('counts the Cabinet and its committees as the issuing body, as before (F125)', () => {
    expect(isCabinetDecision({ ministry: 'Cabinet Committee on Economic Affairs (CCEA)', title: 'Anything', source_url: pib })).toBe(true);
  });

  it('counts a "Cabinet approves" or "Cabinet apprises" release on pib.gov.in filed under a ministry', () => {
    expect(isCabinetDecision({ ministry: 'Ministry of Agriculture & Farmers Welfare', title: 'Cabinet approves Minimum Support Prices for Rabi crops', source_url: pib })).toBe(true);
    expect(isCabinetDecision({ ministry: 'Ministry of Railways', title: 'Cabinet apprises of the progress of the dedicated freight corridors', link: pib })).toBe(true);
    expect(isCabinetDecision({ ministry: 'Ministry of Mines', title: 'Union Cabinet approves the critical minerals mission', source_url: pib })).toBe(true);
  });

  it('still excludes general news, the Cabinet Secretariat and other sites', () => {
    expect(isCabinetDecision({ ministry: 'Ministry of Finance', title: 'Finance Minister says the Cabinet approves of the reform', source_url: pib })).toBe(false);
    expect(isCabinetDecision({ ministry: 'Cabinet Secretariat', title: 'Cabinet Secretary reviews disaster preparedness', source_url: pib })).toBe(false);
    expect(isCabinetDecision({ ministry: '', title: 'Cabinet approves new scheme', source_url: 'https://example.com/news' })).toBe(false);
  });
});
