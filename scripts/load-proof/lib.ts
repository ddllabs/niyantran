// Shared plumbing of the F287 harness: where things are, the local-only guard, the stdio relay to
// PostgREST, the signed tokens, a PostgREST-shaped supabase-js client, and psql through docker.
//
// Nothing here reads .env files, and nothing here can reach a host other than 127.0.0.1 or localhost:
// guardedFetch refuses every other host, so even a worker dependency that was not replaced could not
// call OpenRouter or Mistral.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const CONTAINER = 'niyantran-corpus-test-db';
export const POSTGREST = 'niyantran-load-proof-postgrest';
export const DB = Deno.env.get('LOAD_PROOF_DB') ?? 'niyantran_ingest_load_test';
if (!/^niyantran_ingest_load[a-z0-9_]*_test$/.test(DB)) {
  throw new Error(`database ${DB} is not a niyantran_ingest_load*_test name`);
}

export const HOME = Deno.env.get('HOME') ?? '';
/** Vector and text pools live here, outside the repository. */
export const CACHE_DIR = `${HOME}/niyantran-eval-cache/load-proof`;

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

/** fetch, but only to local hosts. Every network call the harness can make goes through this. */
export const guardedFetch: typeof fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!isLocalUrl(url)) {
    return Promise.reject(new Error(`blocked a request to ${safeHost(url)}: the harness talks to localhost only`));
  }
  return fetch(input, init);
};

// ─── docker ──────────────────────────────────────────────────────────────────

async function run(args: string[], stdin?: string): Promise<{ code: number; out: string; err: string }> {
  const child = new Deno.Command('docker', {
    args,
    env: DOCKER_ENV,
    stdin: stdin === undefined ? 'null' : 'piped',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  if (stdin !== undefined) {
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(stdin));
    await w.close();
  }
  const o = await child.output();
  return { code: o.code, out: new TextDecoder().decode(o.stdout), err: new TextDecoder().decode(o.stderr) };
}

/** psql as the container's superuser on the proof database: -At output, one statement or a whole script on stdin. */
export async function psql(sql: string, opts: { db?: string; vars?: string[] } = {}): Promise<string> {
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
  );
  if (r.code !== 0) throw new Error(`psql failed: ${r.err.trim().split('\n').slice(0, 4).join(' | ')}`);
  return r.out.trim();
}

export async function psqlJson<T = unknown>(sql: string): Promise<T> {
  const out = await psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`);
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
// namespace). Ends when either side closes.
const RELAY_SCRIPT =
  'exec 3<>/dev/tcp/127.0.0.1/3000 || exit 1; cat <&3 & reader=$!; cat >&3; kill $reader 2>/dev/null; wait';

export interface Relay {
  url: string;
  close(): void;
}

/** A TCP listener on 127.0.0.1 whose every connection is a `docker exec` into the database container. */
export function startRelay(): Relay {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  let open = true;
  const live = new Set<() => void>();
  (async () => {
    for await (const conn of listener) {
      const child = new Deno.Command('docker', {
        args: ['exec', '-i', CONTAINER, 'bash', '-c', RELAY_SCRIPT],
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
export function openRest(): Rest {
  const relay = startRelay();
  assertLocalSupabaseUrl(relay.url);
  let secret: Promise<string> | null = null;
  const stripped: typeof fetch = (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    return guardedFetch(raw.replace('/rest/v1/', '/'), init);
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

/** Lines the database container has logged since `sinceIso` that say a statement timed out or deadlocked. */
export async function dbLogTrouble(sinceIso: string): Promise<string[]> {
  const r = await run(['logs', '--since', sinceIso, CONTAINER]);
  return (r.out + r.err).split('\n').filter((l) =>
    /deadlock detected|canceling statement due to statement timeout/i.test(l)
  ).slice(0, 5);
}
