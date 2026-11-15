// Bulk runner (F285, step 10 of the bulk spec): automated acceptance of one batch, §5.3 of
// docs/specs/2026-11-01-bulk-ingestion.md, as decided on 2026-11-09 (docs/specs/2026-11-08-runner-cli-and-acceptance.md):
// a sample of 50 loaded documents, or all of them below 50, each passing every check; read only, from the developer's
// own login, in transactions that are rolled back; the retrieval probe searches with one of the document's own stored
// vectors, so it costs nothing. A probe chunk whose text other documents hold word for word cannot pick the document out
// (F313: gazette headings), so it is set aside and the next chunk is tried, up to PROBE_ATTEMPTS.
import { dollarQuote, type PsqlExec } from './psql_db.ts';

export interface SampleItem {
  source_key: string;
  document_id: string;
  /** What the runner registered (the ledger's hash of the text it sent). */
  content_sha256: string;
  chunks: number;
}

export interface StoredDoc {
  id: string;
  content_sha256: string | null;
  indexed: boolean;
  chunks: number;
  vectors: number;
  desk_tier: string;
  desk_feature: string;
}

/** One probe: the stored text of the chunk whose vector was searched, and the chunks the search returned. */
export interface ProbeResult {
  content: string;
  rows: Array<{ document_id: string; similarity: number; content: string }>;
}

/** A listing row that may hold a document: found through the document's own document_key, or an approved link. */
export interface LinkKey {
  key: string;
  via: 'document_key' | 'link';
}

/** The database as acceptance sees it. Every method only reads. */
export interface AcceptDb {
  /** A sample of the batch's loaded items (admitted or existing, with a document), the same on every run of a batch. */
  sample(batchId: string, n: number): Promise<SampleItem[]>;
  stored(documentIds: string[]): Promise<StoredDoc[]>;
  /** Document id to the listing rows that may hold it, and how each was found. */
  linkKeys(documentIds: string[]): Promise<Record<string, LinkKey[]>>;
  /** record_resolve_document_keys, as a signed-in user; at most 24 keys a call. */
  resolve(keys: string[]): Promise<Array<{ document_key: string; document_id: string | null; coverage: string }>>;
  /**
   * match_documents with the document's own stored vector at position `attempt` (0 is its first chunk with a vector),
   * in its feature, as a signed-in user; null when the document has no vector at that position.
   */
  probe(doc: { id: string; desk_tier: string; desk_feature: string }, attempt: number): Promise<ProbeResult | null>;
  /**
   * F305: the same search as `probe` at the same position, but exact (no index): every chunk of the feature scored at
   * full precision. Absent when the database cannot do it; a failed probe then stays a failure.
   */
  exactProbe?(
    doc: { id: string; desk_tier: string; desk_feature: string },
    attempt: number,
  ): Promise<ProbeResult | null>;
}

export type AcceptCheck =
  | 'nothing_to_check'
  | 'missing_document'
  | 'not_indexed'
  | 'text_hash'
  | 'chunk_count'
  | 'vectors'
  | 'no_listing_link'
  | 'link_not_full'
  | 'probe_empty'
  | 'probe_not_first'
  | 'probe_index_miss_excess';

export interface AcceptFailure {
  source_key: string | null;
  check: AcceptCheck;
  detail?: string;
}

/** F305: a document the index search missed that an exact search ranks first; reported, not a failure on its own. */
export interface IndexMiss {
  source_key: string;
  index_rank: number | 'absent';
  exact_rank: number;
}

export interface AcceptReport {
  batch_id: string;
  sampled: number;
  ok: boolean;
  failures: AcceptFailure[];
  index_misses: IndexMiss[];
}

export interface AcceptOptions {
  /** How many loaded documents to check (decided: 50). */
  sample: number;
  /** Whether every document must be reachable from a listing row (true for Bills). */
  requireLinks: boolean;
}

const RESOLVE_LIMIT = 24;
/** Similarities this close to the best count as tied: a text kept twice by the pack's dedupe list ranks equal. */
const TIE = 1e-6;
/** Chunks tried before a probe whose every chunk is shared word for word fails. */
const PROBE_ATTEMPTS = 3;
/** Index misses a batch may carry: the approximate index can miss one correctly loaded document (F305), not two. */
const MAX_INDEX_MISSES = 1;
const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

type ProbeVerdict =
  | { ok: true; indexMiss?: Omit<IndexMiss, 'source_key'> }
  | { ok: false; check: 'probe_empty' | 'probe_not_first'; detail?: string };

/** The document comes first (a tie at the top counts), or every row ranked above it holds the probe's own text. */
function isFirst(p: ProbeResult, id: string): boolean {
  if (p.rows.length === 0) return false;
  const best = p.rows[0].similarity;
  if (p.rows.some((r) => r.document_id === id && r.similarity >= best - TIE)) return true;
  const rank = p.rows.findIndex((r) => r.document_id === id);
  const own = rank < 0 ? -Infinity : p.rows[rank].similarity;
  return p.rows.filter((r) => r.document_id !== id && r.similarity > own + TIE).every((r) =>
    sameText(r.content, p.content)
  );
}

/**
 * The document must come first (a tie at the top counts). When every chunk ranked above it holds the probe's own text
 * word for word, the probe could not tell the documents apart, and the next chunk is tried; any other text above it is
 * a failure at once.
 */
async function probeDocument(db: AcceptDb, d: StoredDoc): Promise<ProbeVerdict> {
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt++) {
    const p = await db.probe(d, attempt);
    if (!p) {
      return attempt === 0
        ? { ok: false, check: 'probe_empty' }
        : { ok: false, check: 'probe_not_first', detail: `every chunk tried (${attempt}) is shared word for word` };
    }
    if (p.rows.length === 0) return { ok: false, check: 'probe_empty' };
    const best = p.rows[0].similarity;
    if (p.rows.some((r) => r.document_id === d.id && r.similarity >= best - TIE)) return { ok: true };
    const rank = p.rows.findIndex((r) => r.document_id === d.id);
    const own = rank < 0 ? -Infinity : p.rows[rank].similarity;
    const ahead = p.rows.filter((r) => r.document_id !== d.id && r.similarity > own + TIE);
    if (!ahead.every((r) => sameText(r.content, p.content))) {
      // F305: above 15,000 chunks the search is approximate. Search again, exactly, with the same vector; a document
      // the exact search ranks first was missed by the index, not mis-loaded.
      let exact: ProbeResult | null = null;
      let recheckFailed = false;
      try {
        exact = db.exactProbe ? await db.exactProbe(d, attempt) : null;
      } catch {
        recheckFailed = true; // a timeout on a large feature: the original failure stands; no error text is kept
      }
      if (exact && isFirst(exact, d.id)) {
        const exactRank = exact.rows.findIndex((r) => r.document_id === d.id) + 1;
        return { ok: true, indexMiss: { index_rank: rank < 0 ? 'absent' : rank + 1, exact_rank: exactRank } };
      }
      return {
        ok: false,
        check: 'probe_not_first',
        detail: recheckFailed ? 'exact recheck failed' : rank < 0 ? 'not in the top results' : `rank ${rank + 1}`,
      };
    }
  }
  return {
    ok: false,
    check: 'probe_not_first',
    detail: `every chunk tried (${PROBE_ATTEMPTS}) is shared word for word`,
  };
}

/** Runs every check on the sample. Throws when the database cannot answer: an acceptance that cannot be made is none. */
export async function acceptBatch(db: AcceptDb, batchId: string, opt: AcceptOptions): Promise<AcceptReport> {
  if (!Number.isInteger(opt.sample) || opt.sample < 1 || opt.sample > 1000) {
    throw new Error(`bad sample size ${opt.sample}`);
  }
  const items = await db.sample(batchId, opt.sample);
  const failures: AcceptFailure[] = [];
  const indexMisses: IndexMiss[] = [];
  const fail = (it: SampleItem | null, check: AcceptCheck, detail?: string) =>
    failures.push({ source_key: it?.source_key ?? null, check, ...(detail ? { detail } : {}) });
  if (items.length === 0) {
    fail(null, 'nothing_to_check', 'the batch has no loaded document');
    return { batch_id: batchId, sampled: 0, ok: false, failures, index_misses: [] };
  }
  const ids = items.map((it) => it.document_id);
  const stored = new Map((await db.stored(ids)).map((d) => [d.id, d]));
  const keys = await db.linkKeys(ids);
  const allKeys = [...new Set(Object.values(keys).flat().map((l) => l.key))];
  const coverage = new Map<string, string>();
  /** The documents the resolver gives each row: what a reader of that record is shown. */
  const shown = new Map<string, Set<string>>();
  for (let i = 0; i < allKeys.length; i += RESOLVE_LIMIT) {
    for (const r of await db.resolve(allKeys.slice(i, i + RESOLVE_LIMIT))) {
      coverage.set(r.document_key, r.coverage);
      if (!shown.has(r.document_key)) shown.set(r.document_key, new Set());
      if (r.document_id) shown.get(r.document_key)!.add(r.document_id);
    }
  }
  for (const it of items) {
    const d = stored.get(it.document_id);
    if (!d) {
      fail(it, 'missing_document');
      continue;
    }
    if (!d.indexed) {
      fail(it, 'not_indexed');
      continue;
    }
    if (d.content_sha256 !== it.content_sha256) {
      fail(it, 'text_hash', `stored ${d.content_sha256}, registered ${it.content_sha256}`);
      continue;
    }
    if (d.chunks !== it.chunks) {
      fail(it, 'chunk_count', `stored ${d.chunks}, planned ${it.chunks}`);
      continue;
    }
    if (d.vectors !== d.chunks) {
      fail(it, 'vectors', `${d.vectors} of ${d.chunks} chunks have a vector`);
      continue;
    }
    // F316: a row found only through the shared document_key is this document's when the resolver gives it this
    // document; on a shared bill key (F314) the other bill's row does not. An approved link always counts.
    const own = [
      ...new Set(
        (keys[it.document_id] ?? []).filter((l) => l.via === 'link' || shown.get(l.key)?.has(d.id)).map((l) => l.key),
      ),
    ];
    if (own.length === 0 && opt.requireLinks) {
      fail(it, 'no_listing_link');
      continue;
    }
    const notFull = own.filter((k) => coverage.get(k) !== 'full');
    if (notFull.length) {
      fail(
        it,
        'link_not_full',
        `${notFull.length} of ${own.length} listing links: ${coverage.get(notFull[0]) ?? 'unanswered'}`,
      );
      continue;
    }
    const v = await probeDocument(db, d);
    if (!v.ok) fail(it, v.check, v.detail);
    else if (v.indexMiss) indexMisses.push({ source_key: it.source_key, ...v.indexMiss });
  }
  if (indexMisses.length > MAX_INDEX_MISSES) {
    fail(
      null,
      'probe_index_miss_excess',
      `${indexMisses.length} index misses in the sample, at most ${MAX_INDEX_MISSES}`,
    );
  }
  return { batch_id: batchId, sampled: items.length, ok: failures.length === 0, failures, index_misses: indexMisses };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: string) => {
  if (!UUID.test(v)) throw new Error(`not a uuid: ${JSON.stringify(v).slice(0, 80)}`);
  return `'${v}'::uuid`;
};
const uuids = (vs: string[]) => `array[${vs.map(uuid).join(', ')}]::uuid[]`;
const text = (v: string) => dollarQuote(v);

/**
 * AcceptDb through psql, from the developer's own login (not corpus_ingest, which cannot read these tables). Every
 * statement runs in a read-only transaction that is rolled back; the link and probe checks run as `authenticated`.
 */
export class PsqlAcceptDb implements AcceptDb {
  constructor(private readonly exec: PsqlExec, private readonly statementTimeoutMs = 60_000) {}

  private async read<T>(body: string, asUser: boolean): Promise<T> {
    const sql = [
      '\\set ON_ERROR_STOP on',
      'begin transaction read only;',
      `set local statement_timeout = '${this.statementTimeoutMs}ms';`,
      ...(asUser ? ['set local role authenticated;'] : []),
      body,
      'rollback;',
      '',
    ].join('\n');
    const r = await this.exec(sql, this.statementTimeoutMs + 30_000);
    if (r.timedOut) throw new Error('psql gave no answer within the client limit');
    if (r.code !== 0) throw new Error(`psql exited ${r.code}: ${r.stderr.trim().slice(0, 500)}`);
    const out = r.stdout.trim();
    if (!out) throw new Error('psql returned an empty answer');
    return JSON.parse(out) as T;
  }

  sample(batchId: string, n: number): Promise<SampleItem[]> {
    if (!Number.isInteger(n) || n < 1) return Promise.reject(new Error(`bad sample size ${n}`));
    return this.read(
      `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (
         select source_key, document_id, content_sha256, chunks from public.ingest_batch_items
          where batch_id = ${uuid(batchId)} and outcome in ('admitted', 'existing') and document_id is not null
          order by md5(source_key || ${uuid(batchId)}::text) limit ${n}) t;`,
      false,
    );
  }

  stored(ids: string[]): Promise<StoredDoc[]> {
    return this.read(
      `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (
         select d.id, d.content_sha256, d.indexed_at is not null as indexed, d.desk_tier, d.desk_feature,
                (select count(*) from public.document_chunks c where c.document_id = d.id)::int as chunks,
                (select count(*) from public.document_chunks c where c.document_id = d.id and c.embedding is not null)::int
                  as vectors
           from public.documents d where d.id = any(${uuids(ids)})) t;`,
      false,
    );
  }

  linkKeys(ids: string[]): Promise<Record<string, LinkKey[]>> {
    return this.read(
      `select coalesce(jsonb_object_agg(id, keys), '{}'::jsonb)::text from (
         select id, jsonb_agg(distinct jsonb_build_object('key', key, 'via', via)) as keys from (
           select d.id, 'desk-record:' || jsonb_build_array(r.tier, r.feature, r.row_key)::text as key,
                  'document_key' as via
             from public.documents d join public.desk_rows r
               on r.tier = d.desk_tier and r.feature = d.desk_feature and r.document_key = d.metadata->>'document_key'
            where d.id = any(${uuids(ids)})
           union
           select l.document_id, 'desk-record:' || jsonb_build_array(l.tier, l.feature, l.row_key)::text, 'link'
             from public.record_document_links l where l.document_id = any(${uuids(ids)})
         ) k group by id) t;`,
      false,
    );
  }

  resolve(keys: string[]) {
    if (keys.length > RESOLVE_LIMIT) return Promise.reject(new Error(`at most ${RESOLVE_LIMIT} keys a call`));
    return this.read<Array<{ document_key: string; document_id: string | null; coverage: string }>>(
      `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from public.record_resolve_document_keys(
         array(select jsonb_array_elements_text(${text(JSON.stringify(keys))}::jsonb))) t;`,
      true,
    );
  }

  private async chunkAt(doc: { id: string }, attempt: number) {
    if (!Number.isInteger(attempt) || attempt < 0) throw new Error(`bad probe attempt ${attempt}`);
    return await this.read<{ embedding: string; content: string } | null>(
      `select to_jsonb((select jsonb_build_object('embedding', embedding::text, 'content', content)
         from public.document_chunks where document_id = ${uuid(doc.id)} and embedding is not null
         order by chunk_index offset ${attempt} limit 1))::text;`,
      false,
    );
  }

  /**
   * F305: the exact branch of match_documents (20261101120000, lines 960-975), run directly, because calling the
   * function would send a feature over 15,000 chunks to the index. Same filters (embedded, indexed, own feature and
   * tier, the caller's access through RLS as `authenticated`) and the same full-precision order; the planner switches
   * keep every index out of the plan; the search_path is the function's own, which the vector operators need. All local to a read-only transaction that is rolled back.
   */
  async exactProbe(
    doc: { id: string; desk_tier: string; desk_feature: string },
    attempt: number,
  ): Promise<ProbeResult | null> {
    const chunk = await this.chunkAt(doc, attempt);
    if (!chunk) return null;
    const rows = await this.read<ProbeResult['rows']>(
      `set local search_path = public, extensions;
       set local enable_indexscan = off;
       set local enable_bitmapscan = off;
       set local enable_indexonlyscan = off;
       select coalesce(jsonb_agg(jsonb_build_object('document_id', m.document_id, 'similarity', m.similarity,
                'content', m.content) order by m.dist), '[]'::jsonb)::text
         from (select c.document_id, c.content, (1 - (c.embedding <=> ${
        text(chunk.embedding)
      }::extensions.vector))::float8 as similarity,
                      c.embedding <=> ${text(chunk.embedding)}::extensions.vector as dist
                 from public.document_chunks c join public.documents d on d.id = c.document_id
                where c.embedding is not null and d.indexed_at is not null
                  and c.desk_feature = ${text(doc.desk_feature)} and c.desk_tier = ${text(doc.desk_tier)}
                order by c.embedding <=> ${text(chunk.embedding)}::extensions.vector limit 10) m;`,
      true,
    );
    return { content: chunk.content, rows };
  }

  async probe(
    doc: { id: string; desk_tier: string; desk_feature: string },
    attempt: number,
  ): Promise<ProbeResult | null> {
    const chunk = await this.chunkAt(doc, attempt);
    if (!chunk) return null;
    const rows = await this.read<ProbeResult['rows']>(
      `select coalesce(jsonb_agg(jsonb_build_object('document_id', m.document_id, 'similarity', m.similarity,
                'content', m.content) order by m.similarity desc), '[]'::jsonb)::text
         from public.match_documents(${text(chunk.embedding)}::extensions.vector, 10, null::uuid[],
                                     ${text(doc.desk_tier)}, ${text(doc.desk_feature)}) m;`,
      true,
    );
    return { content: chunk.content, rows };
  }
}
