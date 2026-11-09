// Bulk runner (F285): the production Db, through psql as corpus_ingest
// (docs/specs/2026-11-08-runner-cli-and-acceptance.md, slice A). No driver dependency: psql is the client every NTER
// apply already uses. The connection comes from libpq's environment in the developer's terminal (PGHOST, PGPORT,
// PGDATABASE, PGUSER, PGSSLMODE, and PGPASSWORD or a password file); nothing about it is passed in arguments, so it
// never shows in a process list, and nothing here prints it.
import type {
  BatchStatus,
  Db,
  ManifestItem,
  OpenArgs,
  OpenResult,
  RegisterDocument,
  RegisterResponse,
  RequeueResponse,
  TextHolder,
} from './db.ts';

export interface PsqlRun {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs one script and returns what psql printed. `timeoutMs` is the client's own limit. */
export type PsqlExec = (sql: string, timeoutMs: number) => Promise<PsqlRun>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE = 'corpus_ingest';
/** Past the server's statement timeout, so the server's answer, not ours, normally ends a slow call. */
const CLIENT_MARGIN_MS = 30_000;

const randomTag = () => `$q${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}$`;

/** A dollar-quoted literal under a tag that does not occur in the text. */
export function dollarQuote(text: string, nextTag: () => string = randomTag): string {
  for (let i = 0; i < 100; i++) {
    const tag = nextTag();
    if (!/^\$[A-Za-z_][A-Za-z0-9_]*\$$/.test(tag)) throw new Error(`bad dollar tag ${tag}`);
    if (!text.includes(tag)) return `${tag}${text}${tag}`;
  }
  throw new Error('no dollar tag free of the text');
}

const json = (value: unknown) => `${dollarQuote(JSON.stringify(value))}::jsonb`;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${JSON.stringify(value).slice(0, 80)}`);
  return `'${value}'::uuid`;
}

export class PsqlDb implements Db {
  private settings: { lock_timeout_ms: number; statement_timeout_ms: number } | null = null;

  constructor(private readonly exec: PsqlExec) {}

  /** Checks the login is corpus_ingest and keeps the bounds every later call sets (design 5.3). */
  async session(settings: { lock_timeout_ms: number; statement_timeout_ms: number }): Promise<void> {
    for (const v of [settings.lock_timeout_ms, settings.statement_timeout_ms]) {
      if (!Number.isInteger(v) || v < 1) throw new Error(`bad session bound ${v}`);
    }
    const who = (await this.call('select current_user;', settings)).trim();
    if (who !== ROLE) throw new Error(`the runner connects only as ${ROLE}; this login is ${who || 'unknown'}`);
    this.settings = settings;
  }

  private script(body: string, s: { lock_timeout_ms: number; statement_timeout_ms: number }): string {
    return [
      '\\set ON_ERROR_STOP on',
      `set lock_timeout = '${s.lock_timeout_ms}ms';`,
      `set statement_timeout = '${s.statement_timeout_ms}ms';`,
      body,
      '',
    ].join('\n');
  }

  private async call(body: string, s = this.settings): Promise<string> {
    if (!s) throw new Error('call before session(): the login has not been checked');
    const r = await this.exec(this.script(body, s), s.statement_timeout_ms + CLIENT_MARGIN_MS);
    if (r.timedOut) throw new Error('psql gave no answer within the client limit');
    if (r.code !== 0) throw new Error(`psql exited ${r.code}: ${r.stderr.trim().slice(0, 500)}`);
    return r.stdout;
  }

  private async answer<T>(body: string): Promise<T> {
    const out = (await this.call(body)).trim();
    if (!out) throw new Error('psql returned an empty answer');
    return JSON.parse(out) as T;
  }

  async textHolders(hashes: string[]): Promise<TextHolder[]> {
    return await this.answer<TextHolder[]>(
      `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from public.ingest_text_holders(` +
        `array(select jsonb_array_elements_text(${json(hashes)}))) t;`,
    );
  }

  async open(args: OpenArgs): Promise<OpenResult> {
    return await this.answer<OpenResult>(`select public.ingest_batch_open(${json(args)})::text;`);
  }

  async addItems(batch: string, items: ManifestItem[]): Promise<void> {
    await this.answer(`select public.ingest_batch_add_items(${uuid(batch)}, ${json(items)})::text;`);
  }

  async seal(batch: string): Promise<{ state?: string; refused?: string }> {
    return await this.answer(`select public.ingest_batch_seal(${uuid(batch)})::text;`);
  }

  async register(batch: string, documents: RegisterDocument[], dryRun: boolean, allOrNothing: boolean) {
    return await this.answer<RegisterResponse>(
      `select public.ingest_register_batch(${uuid(batch)}, ${json(documents)}, ${dryRun === true}, ` +
        `${allOrNothing === true})::text;`,
    );
  }

  async status(batch: string, sourceKeys?: string[]): Promise<BatchStatus> {
    const keys = sourceKeys ? `array(select jsonb_array_elements_text(${json(sourceKeys)}))` : 'null::text[]';
    return await this.answer<BatchStatus>(`select public.ingest_batch_status(${uuid(batch)}, ${keys})::text;`);
  }

  async stop(batch: string, reason: string): Promise<void> {
    await this.answer(`select public.ingest_batch_stop(${uuid(batch)}, ${dollarQuote(reason)})::text;`);
  }

  async requeue(batch: string, jobIds: string[]): Promise<RequeueResponse> {
    const ids = jobIds.map(uuid).join(', ');
    return await this.answer<RequeueResponse>(
      `select public.ingest_batch_requeue(${uuid(batch)}, array[${ids}]::uuid[])::text;`,
    );
  }
}

/**
 * psql as a child process: `command` is psql and any arguments before the script (for the load copy, a `docker exec`
 * prefix). The script goes in on stdin; `preamble`, for the load copy only, runs first (there: `set role corpus_ingest`,
 * since a local superuser stands in for the login). Production passes neither connection arguments nor a preamble.
 */
export function psqlExec(command: string[] = ['psql'], preamble = '', env?: Record<string, string>): PsqlExec {
  return async (sql, timeoutMs) => {
    const [cmd, ...pre] = command;
    const child = new Deno.Command(cmd, {
      args: [...pre, '-X', '-q', '-A', '-t', '-f', '-'],
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
      // With env, exactly that environment: the acceptance connection must not inherit corpus_ingest's PG* variables.
      ...(env ? { env, clearEnv: true } : {}),
    }).spawn();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch { /* already gone */ }
    }, timeoutMs);
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(preamble ? `${preamble}\n${sql}` : sql));
    await w.close();
    const out = await child.output();
    clearTimeout(timer);
    const dec = new TextDecoder();
    return { code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr), timedOut };
  };
}
