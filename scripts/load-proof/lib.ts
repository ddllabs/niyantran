// Shared plumbing of the F287 harness: where things are, the local-only guard, the stdio relay to
// PostgREST, the signed tokens, a PostgREST-shaped supabase-js client, and psql through docker.
//
// Nothing here reads .env files. Network access is held down twice. In code: guardedFetch refuses a host
// other than 127.0.0.1 or localhost, and the supabase-js clients and the worker's dependencies are given
// only that fetch. In the runtime: the documented commands run Deno with --allow-net=127.0.0.1,localhost
// (scripts/load-proof/lp.sh), which covers anything that does not go through guardedFetch.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** One clock for the whole harness: slices, samples and batches are all seconds since this. */
const T0 = performance.now();
export const elapsedMs = () => performance.now() - T0;

/** Every fetch the harness makes is cut off after this, so a hang becomes an error the run records. */
export const FETCH_TIMEOUT_MS = Number(Deno.env.get('LOAD_PROOF_FETCH_TIMEOUT_MS') ?? 120_000);

export const CONTAINER = 'niyantran-corpus-test-db';
export const POSTGREST = 'niyantran-load-proof-postgrest';
export const DB = Deno.env.get('LOAD_PROOF_DB') ?? 'niyantran_ingest_load_test';
if (!/^niyantran_ingest_load[a-z0-9_]*_test$/.test(DB)) {
  throw new Error(`database ${DB} is not a niyantran_ingest_load*_test name`);
}

export const HOME = Deno.env.get('HOME') ?? '';
/** Vector and text pools live here, outside the repository. */
export const CACHE_DIR = `${HOME}/niyantran-eval-cache/load-proof`;

const DOCKER_TIMEOUT_MS = 180_000;
const DOCKER_ENV = { PATH: `${HOME}/.docker/bin:${Deno.env.get('PATH') ?? ''}` };
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Throws unless the Supabase URL is 127.0.0.1 or localhost. */
export function assertLocalSupabaseUrl(url: string): string {
  if (!isLocalUrl(url)) {
    throw new Error(`refusing to run: the Supabase URL ${safeHost(url)} is not 127.0.0.1 or localhost`);
  }
  return url;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(unparsable)';
  }
}

/** fetch, but only to local hosts, and never for longer than FETCH_TIMEOUT_MS. */
export const guardedFetch: typeof fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!isLocalUrl(url)) {
    return Promise.reject(new Error(`blocked a request to ${safeHost(url)}: the harness talks to localhost only`));
  }
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal }).catch((e) => {
    if (timeout.aborted) throw new Error(`request to ${safeHost(url)} timed out after ${FETCH_TIMEOUT_MS} ms`);
    throw e;
  });
};

/**
 * The Server-Timing header of the PostgREST response a call is waiting on (jwt, parse, plan, transaction,
 * response; ms), handed to whoever opened the scope with callScope.run().
 */
export interface CallScope {
  serverTiming?: Record<string, number>;
}
export const callScope = new AsyncLocalStorage<CallScope>();

function parseServerTiming(h: string | null): Record<string, number> | undefined {
  if (!h) return undefined;
  const out: Record<string, number> = {};
  for (const part of h.split(',')) {
    const m = /^\s*([\w-]+);dur=([\d.]+)/.exec(part);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

// ─── docker ──────────────────────────────────────────────────────────────────

async function run(
  args: string[],
  stdin?: string,
  timeoutMs = DOCKER_TIMEOUT_MS,
): Promise<{ code: number; out: string; err: string }> {
  const child = new Deno.Command('docker', {
    args,
    env: DOCKER_ENV,
    stdin: stdin === undefined ? 'null' : 'piped',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  // A timer that is cleared on exit. (An AbortSignal.timeout handed to Command is never cleared and fires a
  // signal at a process that is long gone.) Killing the docker client does not stop the exec inside.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill('SIGKILL');
    } catch { /* already gone */ }
  }, timeoutMs);
  try {
    if (stdin !== undefined) {
      const w = child.stdin.getWriter();
      await w.write(new TextEncoder().encode(stdin));
      await w.close();
    }
    const o = await child.output();
    if (timedOut) throw new Error(`docker ${args.slice(0, 3).join(' ')} timed out after ${timeoutMs} ms`);
    return { code: o.code, out: new TextDecoder().decode(o.stdout), err: new TextDecoder().decode(o.stderr) };
  } finally {
    clearTimeout(timer);
  }
}

/** psql as the container's superuser on the proof database: -At output, one statement or a whole script on stdin. */
export async function psql(
  sql: string,
  opts: { db?: string; vars?: string[]; timeoutMs?: number } = {},
): Promise<string> {
  const r = await run(
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      opts.db ?? DB,
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      ...(opts.vars ?? []),
    ],
    sql,
    opts.timeoutMs,
  );
  if (r.code !== 0) throw new Error(`psql failed: ${r.err.trim().split('\n').slice(0, 4).join(' | ')}`);
  return r.out.trim();
}

export async function psqlJson<T = unknown>(sql: string, opts: { db?: string } = {}): Promise<T> {
  const out = await psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`, opts);
  return JSON.parse(out) as T;
}

/** The test-only JWT secret, read back from the running PostgREST container. Never printed. */
async function jwtSecret(): Promise<string> {
  const r = await run(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', POSTGREST]);
  if (r.code !== 0) {
    throw new Error(`PostgREST container ${POSTGREST} is not present; run scripts/load-proof/postgrest.sh up`);
  }
  const line = r.out.split('\n').find((l) => l.startsWith('PGRST_JWT_SECRET='));
  if (!line) throw new Error('the PostgREST container has no JWT secret');
  return line.slice('PGRST_JWT_SECRET='.length);
}

// ─── the relay ───────────────────────────────────────────────────────────────

// Inside the database container: stdin/stdout to 127.0.0.1:3000 (PostgREST shares its network
// namespace). One perl process copies both ways and exits when EITHER side reaches EOF, so a server-side
// close reaches the client instead of leaving a dead keep-alive connection, and nothing is left behind.
//
// The relay must leave nothing behind inside the container, because PostgreSQL there is PID 1 and adopts every
// orphan. If an adopted process then ends on a signal, the postmaster reads it as a crashed backend ("server
// process was terminated by signal 15") and restarts every connection. A bash relay that ran `kill` on its
// copies and exited without `wait` did this six times on 2026-11-06, between 02:01 and 02:21 UTC, and it was
// reproduced on a disposable container the same day. One exec'd process has no children to leave.
export const RELAY_SCRIPT = "exec perl -MIO::Socket::INET -MIO::Select -e '" +
  'my $s = IO::Socket::INET->new(PeerAddr => "127.0.0.1:3000") or exit 1; binmode STDIN; binmode STDOUT; binmode $s; ' +
  'my $sel = IO::Select->new(\\*STDIN, $s); my $buf; ' +
  'while (my @r = $sel->can_read) { for my $fh (@r) { my $n = sysread($fh, $buf, 65536); exit 0 unless $n; ' +
  'my $out = ($fh == $s) ? \\*STDOUT : $s; my $off = 0; ' +
  "while ($off < $n) { my $w = syswrite($out, $buf, $n - $off, $off); exit 0 unless defined $w; $off += $w; } } }'";

/** The script the relay used before 2026-11-06: it ends only when the CLIENT closes. Kept for relay_test.ts. Its `wait` is what makes its `kill` safe. */
export const OLD_RELAY_SCRIPT =
  'exec 3<>/dev/tcp/127.0.0.1/3000 || exit 1; cat <&3 & reader=$!; cat >&3; kill $reader 2>/dev/null; wait';

export interface Relay {
  url: string;
  close(): void;
}

/** A TCP listener on 127.0.0.1 whose every connection is a `docker exec` into the database container. */
export function startRelay(script = RELAY_SCRIPT): Relay {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  let open = true;
  const live = new Set<() => void>();
  (async () => {
    for await (const conn of listener) {
      const child = new Deno.Command('docker', {
        args: ['exec', '-i', CONTAINER, 'bash', '-c', script],
        env: DOCKER_ENV,
        stdin: 'piped',
        stdout: 'piped',
        stderr: 'null',
      }).spawn();
      const end = () => {
        try {
          conn.close();
        } catch { /* already closed */ }
        try {
          child.kill();
        } catch { /* already gone */ }
      };
      live.add(end);
      conn.readable.pipeTo(child.stdin).catch(end);
      child.stdout.pipeTo(conn.writable).catch(end).then(end);
    }
  })().catch(() => {});
  return {
    url: `http://127.0.0.1:${port}`,
    close() {
      if (!open) return;
      open = false;
      listener.close();
      for (const end of live) end();
    },
  };
}

// ─── tokens and clients ──────────────────────────────────────────────────────

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replaceAll(
    '=',
    '',
  );

async function signJwt(secret: string, claims: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 24 * 3600, ...claims }),
  );
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return `${head}.${body}.${
    b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`))))
  }`;
}

export type Role = 'service_role' | 'authenticated' | 'corpus_ingest' | 'anon';

export interface Rest {
  relay: Relay;
  /** The base URL the supabase-js clients are given (the relay). */
  url: string;
  client(role: Role): Promise<SupabaseClient>;
  close(): void;
}

/**
 * Starts the relay and returns clients per role. supabase-js talks to /rest/v1; PostgREST serves at the
 * root, so the prefix is stripped on the way through. Refuses to start unless the URL is local.
 */
/** A signed token for a role, for a raw request. Never printed. */
export async function mintToken(role: Role): Promise<string> {
  return await signJwt(await jwtSecret(), { role });
}

export function openRest(): Rest {
  const relay = startRelay();
  assertLocalSupabaseUrl(relay.url);
  let secret: Promise<string> | null = null;
  const stripped: typeof fetch = async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const res = await guardedFetch(raw.replace('/rest/v1/', '/'), init);
    const scope = callScope.getStore();
    if (scope) scope.serverTiming = parseServerTiming(res.headers.get('server-timing'));
    return res;
  };
  return {
    relay,
    url: relay.url,
    async client(role) {
      secret ??= jwtSecret();
      const claims = role === 'authenticated'
        ? { role, sub: '00000000-0000-4000-8000-000000000001', aud: 'authenticated' }
        : { role };
      const token = await signJwt(await secret, claims);
      return createClient(relay.url, token, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: stripped },
      });
    },
    close: () => relay.close(),
  };
}

// ─── small utilities ─────────────────────────────────────────────────────────

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Host free space in GiB, from df on the Docker data root's host volume (the macOS root volume). */
export async function hostFreeGiB(): Promise<number> {
  const child = await new Deno.Command('df', { args: ['-k', '/'], stdout: 'piped' }).output();
  const line = new TextDecoder().decode(child.stdout).trim().split('\n').pop() ?? '';
  const kb = Number(line.split(/\s+/)[3]);
  if (!Number.isFinite(kb)) throw new Error(`cannot read free disk from df: ${line}`);
  return kb / 1024 / 1024;
}

const LOG_TROUBLE =
  /deadlock detected|canceling statement due to statement timeout|terminated by signal|all server processes terminated|not properly shut down|PANIC:/i;

/** A log line that stops a run: a timeout, a deadlock, or any sign the server crashed and restarted. */
export const isLogTrouble = (line: string) => LOG_TROUBLE.test(line);

/** Enough for several sample intervals at the rate this log has ever moved. */
const LOG_TAIL = 20_000;
let lastLogLook = 0;

/**
 * Lines the database container has logged since `sinceIso` that would stop a run.
 *
 * It reads backwards with --tail and filters on Docker's own timestamps. On this container `docker logs
 * --since` exits 0 with no lines, and a full read ends at 2026-10-31, while --tail reaches the present, so a
 * check built on --since would report "nothing found" whatever the database logged. log-check_test.ts writes
 * a real timeout and looks for it.
 *
 * A failed `docker logs`, or a log that moved past the whole tail since the last look, throws: a check that
 * cannot look must not read as "nothing found".
 */
export async function dbLogTrouble(sinceIso: string): Promise<string[]> {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) throw new Error(`dbLogTrouble: not a time: ${sinceIso}`);
  const r = await run(['logs', '--tail', String(LOG_TAIL), '--timestamps', CONTAINER]);
  if (r.code !== 0) throw new Error(`docker logs failed (${r.code}): ${r.err.trim().slice(0, 200)}`);
  const lines = (r.out + r.err).split('\n').filter((l) => l.length > 0);
  const at = (l: string) => Date.parse(`${l.slice(0, 23)}Z`);
  const oldest = Math.min(...lines.slice(0, 1).concat(lines.slice(-1)).map(at));
  if (lines.length >= LOG_TAIL && lastLogLook > 0 && oldest > lastLogLook) {
    throw new Error(`the database log moved past ${LOG_TAIL} lines between two looks; lines were not read`);
  }
  lastLogLook = Date.now();
  return lines.filter((l) => at(l) >= since && isLogTrouble(l)).slice(0, 5);
}

/** The PostgREST container's PGRST_DB_POOL (its connections to the database). */
export async function postgrestPool(): Promise<number> {
  const r = await run(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', POSTGREST]);
  if (r.code !== 0) {
    throw new Error(`PostgREST container ${POSTGREST} is not present; run scripts/load-proof/postgrest.sh up`);
  }
  const line = r.out.split('\n').find((l) => l.startsWith('PGRST_DB_POOL='));
  return Number(line?.slice('PGRST_DB_POOL='.length) ?? 10);
}

/** The directory of a path: "." for a bare file name, "/" for a file in the root. (slice(0, -1) of a bare name cut its last letter.) */
export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '.');
