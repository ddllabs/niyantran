import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Task B (2026-10-16): PIB-backed official modules whose source was read but listed nothing of theirs
 * say so with meta.nothing_new, and the refresh records that as a success that keeps the stored items.
 * The first timer run (2026-10-15) recorded Cabinet Decisions as failed every hour ("No Cabinet decision
 * in the latest PIB window (20 releases checked)") and the Policy Pipeline Tracker six times in a row.
 * PIB is stubbed with English RSS titles and release pages (the shapes of cabinetFeed.test.js).
 */
const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map(([t, prid]) => `<item><title>${t}</title><link>https://pib.gov.in/PressReleaseIframePage.aspx?PRID=${prid}</link></item>`).join('')}</channel></rss>`;
const page = (title, ministry) => `<html><head><meta property="og:title" content="${title} | Press Information Bureau" /></head><body>
  <div class="MinistryNameSubhead">${ministry}</div> Posted On: 12 Oct 2026</body></html>`;

const NOT_CABINET = [
  ['Finance Minister addresses an investment forum in New Delhi', 2222, 'Ministry of Finance'],
  ['Mahila Kisan Diwas 2026 celebrated today across the country', 2223, 'Ministry of Agriculture'],
];

function respond(url, body, type) {
  return new Response(body, { status: 200, headers: { 'content-type': type } });
}

/**
 * PIB's RSS lists `items`; `rssDown` makes every RSS request fail (PIB unreachable). `pages` decides how
 * a release page answers, by PRID: 'ok' (the default), 429 (rate-limited) or 'challenge' (a bot check
 * that answers 200 with no release in it).
 */
function stubPib(items, { rssDown = false, pages = () => 'ok' } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const u = String(input?.url || input);
    if (/RssMain/i.test(u)) {
      if (rssDown) throw new Error('connect ECONNRESET');
      return respond(u, rss(items.map(([t, prid]) => [t, prid])), 'application/rss+xml');
    }
    const prid = (/PRID=(\d+)/.exec(u) || [])[1];
    const how = pages(prid);
    if (how === 429) return new Response('Too Many Requests', { status: 429 });
    if (how === 'challenge') return respond(u, '<html><body><script>/* checking your browser */</script></body></html>', 'text/html');
    const hit = items.find(([, p]) => String(p) === prid);
    if (!hit) return new Response('', { status: 404 });
    return respond(u, page(hit[0], hit[2]), 'text/html');
  }));
}

const feed = async (feature) => {
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier: 'national', feature }));
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Cabinet Decisions: nothing new in PIB\'s latest releases', () => {
  it('says nothing_new, and still shows the page its stored decisions', async () => {
    stubPib(NOT_CABINET);
    const out = await feed('Cabinet Decisions');
    expect(out.meta?.nothing_new).toBe(true);
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.source.note).toMatch(/no Cabinet decision in the latest PIB window \(2 releases checked\)/i);
  });

  it('a live decision is an ordinary answer, without the flag', async () => {
    stubPib([['Cabinet approves the Example Scheme for 2026-27', 1111, 'Cabinet Committee on Economic Affairs (CCEA)'], ...NOT_CABINET]);
    const out = await feed('Cabinet Decisions');
    expect(out.rows.map((r) => r.title)).toEqual(['Cabinet approves the Example Scheme for 2026-27']);
    expect(out.meta?.nothing_new).toBeUndefined();
  });

  it('PIB unreachable is not "nothing new"', async () => {
    stubPib([], { rssDown: true });
    const out = await feed('Cabinet Decisions');
    expect(out.meta?.nothing_new).toBeUndefined();
  });
});

describe('Policy Pipeline Tracker: no release about policy in the making', () => {
  it('says nothing_new beside its status row', async () => {
    stubPib(NOT_CABINET);
    const out = await feed('Policy Pipeline Tracker (Draft-to-Gazette)');
    expect(out.rows.every((r) => r.status === 'source_status')).toBe(true);
    expect(out.meta?.nothing_new).toBe(true);
  });

  it('PIB unreachable is not "nothing new"', async () => {
    stubPib([], { rssDown: true });
    const out = await feed('Policy Pipeline Tracker (Draft-to-Gazette)');
    expect(out.meta?.nothing_new).toBeUndefined();
  });
});

// Review of 1345bfd, finding 3: the RSS answering is not enough. A release page tells whether a release
// is the Cabinet's (and gives a Hindi release its English title); when the pages could not be read,
// nothing is known to be new or not, so the run is not "nothing new".
const HINDI = [
  ['केंद्रीय मंत्रिमंडल ने आज एक योजना को मंजूरी दी', 3331, 'Cabinet'],
  ['प्रधानमंत्री ने आज नई दिल्ली में एक कार्यक्रम को संबोधित किया', 3332, 'Prime Minister\'s Office'],
];

describe('release pages that could not be read are not "nothing new" (review finding 3)', () => {
  it('Cabinet Decisions: every release page answers 429', async () => {
    stubPib(NOT_CABINET, { pages: () => 429 });
    const out = await feed('Cabinet Decisions');
    expect(out.meta?.nothing_new).toBeUndefined();
    // The page still shows the stored decisions, and does not claim the releases were checked.
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.source.note).toMatch(/2 of their release pages could not be read/);
  });

  it('Cabinet Decisions: a challenge page in place of every release', async () => {
    stubPib(NOT_CABINET, { pages: () => 'challenge' });
    expect((await feed('Cabinet Decisions')).meta?.nothing_new).toBeUndefined();
  });

  it('Cabinet Decisions: one page read and one refused is not enough either', async () => {
    stubPib(NOT_CABINET, { pages: (prid) => (prid === '2223' ? 429 : 'ok') });
    expect((await feed('Cabinet Decisions')).meta?.nothing_new).toBeUndefined();
  });

  it('the Policy Pipeline: Hindi releases whose pages answer 429', async () => {
    stubPib(HINDI, { pages: () => 429 });
    const out = await feed('Policy Pipeline Tracker (Draft-to-Gazette)');
    expect(out.meta?.nothing_new).toBeUndefined();
  });

  it('the Policy Pipeline: English titles judged without any page are still nothing new', async () => {
    stubPib(NOT_CABINET, { pages: () => 429 });
    expect((await feed('Policy Pipeline Tracker (Draft-to-Gazette)')).meta?.nothing_new).toBe(true);
  });
});

describe('the refresh records it as a success that keeps the stored items', () => {
  const token = '00000000-0000-4000-8000-000000000001';
  async function refreshOne(feature) {
    const { refreshDue } = await import('../../server/feedStore.mjs');
    const records = [];
    const queue = [{ tier: 'national', feature, variant: '', class: 'official', kind: 'official', interval_minutes: 60, lease_token: token }];
    const rpc = async (name, args) => {
      if (name === 'feed_claim_due') return queue.splice(0, args.p_limit);
      if (name === 'feed_record') {
        records.push(args.p);
        return { status: args.p.nothing_new ? 'unchanged' : args.p.status };
      }
      throw new Error(`unexpected rpc ${name}`);
    };
    await refreshDue({ rpc });
    return records[0];
  }

  it('Cabinet Decisions with no new decision: ok, nothing_new, no items', async () => {
    stubPib(NOT_CABINET);
    expect(await refreshOne('Cabinet Decisions')).toMatchObject({ status: 'ok', nothing_new: true, items: [], error: null });
  });

  it('the Policy Pipeline with no policy release: ok, nothing_new, no items', async () => {
    stubPib(NOT_CABINET);
    expect(await refreshOne('Policy Pipeline Tracker (Draft-to-Gazette)')).toMatchObject({ status: 'ok', nothing_new: true, items: [] });
  });

  it('PIB unreachable is still a failure', async () => {
    stubPib([], { rssDown: true });
    const rec = await refreshOne('Cabinet Decisions');
    expect(rec.status).toBe('failed');
    expect(rec).not.toHaveProperty('nothing_new');
  });

  it('release pages answering 429 are a failure, not nothing new (review finding 3)', async () => {
    stubPib(NOT_CABINET, { pages: () => 429 });
    const rec = await refreshOne('Cabinet Decisions');
    expect(rec.status).toBe('failed');
    expect(rec).not.toHaveProperty('nothing_new');
    stubPib(HINDI, { pages: () => 429 });
    const pipeline = await refreshOne('Policy Pipeline Tracker (Draft-to-Gazette)');
    expect(pipeline.status).toBe('failed');
    expect(pipeline).not.toHaveProperty('nothing_new');
  });
});
