// T6: nter.news articles are stored in Supabase (public.nter_news_articles)
// instead of a per-instance /tmp file. Ingest upserts through
// upsert_nter_article(); the home Latest read selects from the table and falls
// back to the committed seed only when the table is empty or unreachable.
import { describe, expect, it, vi } from 'vitest';
import { ingestNterArticle, serveNterLatest } from '../../server/nterNews.mjs';

function fakeAdmin({ upsert = 'created', upsertError = null, rows = [], readError = null } = {}) {
  const calls = { upserts: [], reads: [] };
  const admin = {
    calls,
    rpc: vi.fn(async (name, args) => {
      expect(name).toBe('upsert_nter_article');
      calls.upserts.push(args.p);
      return { data: upsertError ? null : upsert, error: upsertError };
    }),
    from: vi.fn((table) => {
      const q = { table };
      calls.reads.push(q);
      const chain = {
        select: (cols) => { q.cols = cols; return chain; },
        order: (col, opts) => { q.order = [col, opts]; return chain; },
        limit: async (n) => { q.limit = n; return { data: readError ? null : rows, error: readError }; },
      };
      return chain;
    }),
  };
  return admin;
}

const article = {
  event: 'article.published',
  article: {
    article_id: 'nt-42',
    title: 'The Donation Box has Reached the Courtroom',
    url: 'https://nter.news/national/donation-box',
    summary: 'The Supreme Court has been told…',
    published_at: '2026-09-28T08:00:00Z',
    updated_at: '2026-09-28T09:00:00Z',
    image_url: '/img/box.jpg',
    category: 'national',
  },
};

describe('ingestNterArticle', () => {
  it('upserts the normalised article into Supabase', async () => {
    const admin = fakeAdmin();
    const out = await ingestNterArticle(article, { sourceHeader: 'nter.news' }, { adminClient: () => admin });
    expect(out).toMatchObject({ ok: true, status: 200, article_id: 'nt-42', upserted: 'created' });
    expect(admin.calls.upserts).toHaveLength(1);
    expect(admin.calls.upserts[0]).toMatchObject({
      article_id: 'nt-42',
      title: 'The Donation Box has Reached the Courtroom',
      link: 'https://nter.news/national/donation-box',
      img: 'https://nter.news/img/box.jpg',
      updated_at: '2026-09-28T09:00:00Z',
    });
    expect(admin.calls.upserts[0]).not.toHaveProperty('ago');
  });

  it('reports a stale revision as skipped', async () => {
    const out = await ingestNterArticle(article, {}, { adminClient: () => fakeAdmin({ upsert: 'skipped_stale' }) });
    expect(out).toMatchObject({ ok: true, upserted: 'skipped_stale' });
  });

  it('answers 503 when the store is unavailable', async () => {
    const out = await ingestNterArticle(article, {}, { adminClient: () => fakeAdmin({ upsertError: { message: 'down' } }) });
    expect(out).toMatchObject({ ok: false, status: 503 });
  });

  it('refuses a payload without a title or an unsupported event before touching the store', async () => {
    const admin = fakeAdmin();
    expect(await ingestNterArticle({ article: { article_id: 'x' } }, {}, { adminClient: () => admin })).toMatchObject({ ok: false, status: 400 });
    expect(await ingestNterArticle({ event: 'article.deleted', article: article.article }, {}, { adminClient: () => admin })).toMatchObject({ ok: false, status: 400 });
    expect(admin.calls.upserts).toEqual([]);
  });
});

describe('serveNterLatest', () => {
  it('serves the newest stored articles', async () => {
    const stored = [
      { row: { article_id: 'b', title: 'B', link: 'https://nter.news/b', pub: '2026-09-28T10:00:00Z', src: 'nter.news' }, updated_at: '2026-09-28T10:00:00Z' },
      { row: { article_id: 'a', title: 'A', link: 'https://nter.news/a', pub: '2026-09-28T09:00:00Z', src: 'nter.news' }, updated_at: '2026-09-28T09:00:00Z' },
    ];
    const admin = fakeAdmin({ rows: stored });
    const out = await serveNterLatest({ limit: 5 }, { adminClient: () => admin });
    expect(out.rows.map((r) => r.article_id)).toEqual(['b', 'a']);
    expect(out.rows.every((r) => r.fallback !== true)).toBe(true);
    expect(out.rows[0].ago).toBeTruthy();
    expect(out.updated).toBe('2026-09-28T10:00:00Z');
    expect(admin.calls.reads[0]).toMatchObject({ table: 'nter_news_articles', order: ['updated_at', { ascending: false }], limit: 5 });
  });

  it('falls back to the committed seed when the table is empty or unreachable', async () => {
    for (const admin of [fakeAdmin({ rows: [] }), fakeAdmin({ readError: { message: 'down' } })]) {
      const out = await serveNterLatest({ limit: 4 }, { adminClient: () => admin });
      expect(out.ok).toBe(true);
      expect(out.rows.length).toBeGreaterThan(0);
      expect(out.rows.length).toBeLessThanOrEqual(4);
      expect(out.rows.every((r) => r.fallback === true)).toBe(true);
    }
  });
});
