// Screening stage (F307, S1): the real LiveReader. Read only, through psql and a libpq service (default `nter-accept`,
// the developer's own login, as automated acceptance uses). Every statement runs in a read-only transaction that is
// rolled back, and the session must confirm it is read-only before its answer is believed. Keys travel as dollar-quoted
// JSON, never as SQL text. Spec: docs/specs/2026-11-10-screening-stage.md.
import { serviceEnv } from './cli.ts';
import { dollarQuote, type PsqlExec, psqlExec } from './psql_db.ts';
import type { LiveDeskRow, LiveDocument, LiveReader } from './screen_types.ts';

/** At most this many keys in one statement. */
export const LIVE_BATCH = 500;
const MAX_KEY_CHARS = 4_000;
const CLIENT_MARGIN_MS = 30_000;
const SERVICE = /^[A-Za-z0-9_.-]{1,64}$/;

function checkKeys(keys: unknown, what: string): string[] {
  if (!Array.isArray(keys)) throw new Error(`${what}: keys must be a list`);
  for (const k of keys) {
    if (typeof k !== 'string' || k === '' || k.length > MAX_KEY_CHARS || k.includes('\0')) {
      throw new Error(`${what}: a key is not a non-empty string without NUL of at most ${MAX_KEY_CHARS} characters`);
    }
  }
  return keys;
}

const batches = <T>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += LIVE_BATCH) out.push(items.slice(i, i + LIVE_BATCH));
  return out;
};

const jsonList = (keys: string[]) => `${dollarQuote(JSON.stringify(keys))}::jsonb`;
const asTextArray = (keys: string[]) => `array(select jsonb_array_elements_text(${jsonList(keys)}))`;

export class PsqlLiveReader implements LiveReader {
  constructor(private readonly exec: PsqlExec, private readonly statementTimeoutMs = 60_000) {
    if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1) {
      throw new Error(`bad statement timeout ${statementTimeoutMs}`);
    }
  }

  /** One read-only statement returning one JSON array; the session's own word that it is read-only comes first. */
  private async read<T>(query: string): Promise<T[]> {
    const sql = [
      '\\set ON_ERROR_STOP on',
      'begin transaction read only;',
      `set local statement_timeout = '${this.statementTimeoutMs}ms';`,
      "select current_setting('transaction_read_only');",
      query,
      'rollback;',
      '',
    ].join('\n');
    const r = await this.exec(sql, this.statementTimeoutMs + CLIENT_MARGIN_MS);
    if (r.timedOut) throw new Error('psql gave no answer within the client limit');
    if (r.code !== 0) throw new Error(`psql exited ${r.code}: ${r.stderr.trim().slice(0, 500)}`);
    const [first, ...rest] = r.stdout.trim().split('\n');
    if (first?.trim() !== 'on') {
      throw new Error('the session did not confirm a read-only transaction; refusing its answer');
    }
    const body = rest.join('\n').trim();
    if (!body) throw new Error('psql returned an empty answer');
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('psql answer is not JSON');
    }
    if (!Array.isArray(parsed)) throw new Error('psql answer is not an array');
    return parsed as T[];
  }

  async documents(q: {
    sourceKeys: string[];
    fileUrls: string[];
    contentHashes?: string[];
    documentKeys?: string[];
    tier?: string;
    feature?: string;
  }): Promise<LiveDocument[]> {
    const sourceKeys = batches(checkKeys(q.sourceKeys, 'documents.sourceKeys'));
    const fileUrls = batches(checkKeys(q.fileUrls, 'documents.fileUrls'));
    const contentHashes = batches(checkKeys(q.contentHashes ?? [], 'documents.contentHashes'));
    const documentKeys = batches(checkKeys(q.documentKeys ?? [], 'documents.documentKeys'));
    if (documentKeys.length > 0) {
      // A document key is only meaningful within one tier and feature; they also let the partial index be used.
      if (typeof q.tier !== 'string' || q.tier === '' || q.tier.includes('\0')) {
        throw new Error('documents: documentKeys need a tier');
      }
      if (typeof q.feature !== 'string' || q.feature === '' || q.feature.includes('\0')) {
        throw new Error('documents: documentKeys need a feature');
      }
    }
    const seen = new Map<string, LiveDocument>();
    const rounds = Math.max(sourceKeys.length, fileUrls.length, contentHashes.length, documentKeys.length);
    // Any failed batch throws out of the loop: the caller never sees a partial result.
    for (let i = 0; i < rounds; i++) {
      const terms: string[] = [];
      if (sourceKeys[i]) terms.push(`source_key = any(${asTextArray(sourceKeys[i])})`);
      if (fileUrls[i]) terms.push(`file_url = any(${asTextArray(fileUrls[i])})`);
      if (contentHashes[i]) terms.push(`content_sha256 = any(${asTextArray(contentHashes[i])})`);
      if (documentKeys[i]) {
        terms.push(
          `(desk_tier = ${dollarQuote(q.tier!)} and desk_feature = ${dollarQuote(q.feature!)} ` +
            `and metadata->>'document_key' = any(${asTextArray(documentKeys[i])}))`,
        );
      }
      const rows = await this.read<LiveDocument>(
        `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (
           select id, source_key, file_url, file_name, desk_feature, metadata->>'document_key' as document_key,
                  metadata->>'house' as house, metadata->>'document_role' as document_role, content_sha256
             from public.documents
            where ${terms.join(' or ')}) t;`,
      );
      for (const d of rows) if (!seen.has(d.id)) seen.set(d.id, d);
    }
    return [...seen.values()];
  }

  async identity(
    q: { tier: string; feature: string },
  ): Promise<{ database: string; server: string; documents: number; deskRows: number }> {
    for (const v of [q?.tier, q?.feature]) {
      if (typeof v !== 'string' || v === '' || v.includes('\0')) {
        throw new Error('identity: tier and feature must be non-empty strings without NUL');
      }
    }
    const tier = dollarQuote(q.tier);
    const feature = dollarQuote(q.feature);
    const rows = await this.read<Record<string, unknown>>(
      `select jsonb_build_array(jsonb_build_object(
         'database', current_database(),
         'server', coalesce(host(inet_server_addr()), 'local'),
         'documents', (select count(*) from public.documents where desk_tier = ${tier} and desk_feature = ${feature}),
         'deskRows', (select count(*) from public.desk_rows where tier = ${tier} and feature = ${feature})))::text;`,
    );
    const [r] = rows;
    const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
    if (
      rows.length !== 1 || typeof r?.database !== 'string' || !r.database || typeof r.server !== 'string' ||
      !r.server || !count(r.documents) || !count(r.deskRows)
    ) {
      throw new Error('identity: the answer is not one database, one server and two counts');
    }
    return { database: r.database, server: r.server, documents: r.documents as number, deskRows: r.deskRows as number };
  }

  async deskRows(q: { tier: string; feature: string; documentKeys: string[] }): Promise<LiveDeskRow[]> {
    const keys = batches(checkKeys(q.documentKeys, 'deskRows.documentKeys'));
    if (
      typeof q.tier !== 'string' || typeof q.feature !== 'string' || q.tier.includes('\0') || q.feature.includes('\0')
    ) {
      throw new Error('deskRows: tier and feature must be strings without NUL');
    }
    const out: LiveDeskRow[] = [];
    for (const batch of keys) {
      out.push(
        ...await this.read<LiveDeskRow>(
          `select coalesce(jsonb_agg(to_jsonb(t) order by t.row_key), '[]'::jsonb)::text from (
             select tier, feature, row_key, document_key, row from public.desk_rows
              where tier = ${dollarQuote(q.tier)} and feature = ${dollarQuote(q.feature)}
                and document_key = any(${asTextArray(batch)})) t;`,
        ),
      );
    }
    return out;
  }
}

/**
 * The reader for the real database: psql through the libpq service, with every PG* variable but the service and
 * password file locations removed from the environment (they name the corpus_ingest login).
 */
export function psqlLiveReader(
  service = 'nter-accept',
  psql = 'psql',
  makeExec: typeof psqlExec = psqlExec,
  base?: Record<string, string>,
): PsqlLiveReader {
  if (!SERVICE.test(service)) throw new Error('bad libpq service name');
  return new PsqlLiveReader(makeExec([psql], '', serviceEnv(service, base)));
}
