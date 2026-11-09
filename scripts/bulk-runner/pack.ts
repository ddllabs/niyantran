// Bulk runner pack reader (F285, C1): turns one documents entry of one National pack on Drive into a records file the
// runner accepts, with a receipt that proves where every line came from (docs/specs/2026-11-10-pack-reader.md).
//
//   deno run -A scripts/bulk-runner/pack.ts list   --pack National/v1.1 [--key <path>]
//   deno run -A scripts/bulk-runner/pack.ts select --pack National/v1.1 --entry documents/parliamentary_questions.jsonl.gz
//                                                  --out <file outside the repository> [--skip-keys <file>]
//                                                  [--limit <n>] [--cache <dir>] [--key <path>]
//
// The key is the read-only service account's key file (default ~/.config/niyantran/drive-reader.json). Nothing here
// prints the key, a token or record text: logs and the receipt hold counts, names and hashes only.
import { createHash } from 'node:crypto';
import { basename, dirname, fromFileUrl, isAbsolute, join, relative, resolve, SEPARATOR } from 'jsr:@std/path@1';
import { createDriveClient, type DriveClient, type DriveItem, parseKey } from './drive.ts';
import { entryStream, readDirectory, type ReadRange, type ZipEntry } from './zip.ts';

export const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), '../..');

const USAGE = 'usage: pack.ts list|select (see the header of scripts/bulk-runner/pack.ts)';
const PREFIX = 'citation_pack_v1/';
const SUBFOLDER = 'file to ingest';
const ZIP_NAME = /^NTER_citation_pack_.*\.zip$/;
const SCHEMA_PREFIX = 'nter.citation_pack/1.';
const SAFE_SEGMENT = /^[A-Za-z0-9._ -]+$/;
const MANIFEST_NAMES = ['manifest.json', 'manifest_delta.json'];
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

export type Command =
  | { cmd: 'list'; pack: string; key: string | null }
  | {
    cmd: 'select';
    pack: string;
    entry: string;
    out: string;
    skipKeys: string | null;
    limit: number | null;
    cache: string | null;
    key: string | null;
  };

export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    const v = rest[i + 1];
    if (!k?.startsWith('--') || v === undefined || v.startsWith('--')) throw new Error(`bad argument ${k}. ${USAGE}`);
    if (flags.has(k)) throw new Error(`${k} given twice`);
    flags.set(k, v);
  }
  const need = (k: string) => {
    const v = flags.get(k);
    if (!v) throw new Error(`${k} is required. ${USAGE}`);
    return v;
  };
  const allowed = (ks: string[]) => {
    for (const k of flags.keys()) if (!ks.includes(k)) throw new Error(`unknown option ${k} for ${cmd}`);
  };
  switch (cmd) {
    case 'list':
      allowed(['--pack', '--key']);
      return { cmd, pack: need('--pack'), key: flags.get('--key') ?? null };
    case 'select': {
      allowed(['--pack', '--entry', '--out', '--skip-keys', '--limit', '--cache', '--key']);
      const l = flags.get('--limit');
      if (l !== undefined && !/^[1-9][0-9]{0,9}$/.test(l)) throw new Error('--limit must be a positive whole number');
      return {
        cmd,
        pack: need('--pack'),
        entry: need('--entry'),
        out: need('--out'),
        skipKeys: flags.get('--skip-keys') ?? null,
        limit: l === undefined ? null : Number(l),
        cache: flags.get('--cache') ?? null,
        key: flags.get('--key') ?? null,
      };
    }
    default:
      throw new Error(USAGE);
  }
}

/** Only packs under National/ are read (Legal is on hold). A path of plain names, nothing relative. */
export function checkPack(pack: string): string {
  const parts = pack.split('/');
  if (
    parts.length < 2 || parts[0] !== 'National' || !parts.every((p) => SAFE_SEGMENT.test(p) && p !== '.' && p !== '..')
  ) {
    throw new Error(
      `--pack must be a path under National/, such as National/v1.1; not ${JSON.stringify(pack.slice(0, 80))}`,
    );
  }
  return pack;
}

/** A documents entry, `documents/<name>.jsonl.gz`, relative to citation_pack_v1/ (not rows, links, README or manifest). */
export function checkEntry(entry: string): string {
  if (!/^documents\/[A-Za-z0-9 _-][A-Za-z0-9._ -]*\.jsonl\.gz$/.test(entry)) {
    throw new Error(
      `--entry must be documents/<name>.jsonl.gz inside the pack, not ${JSON.stringify(entry.slice(0, 80))}`,
    );
  }
  return entry;
}

export interface PackDeps {
  /** A Drive client from the key file at this path. */
  drive: (keyPath: string) => Promise<DriveClient>;
  /** The reader's commit, and whether its code has uncommitted changes. */
  git: () => Promise<{ commit: string; dirty: boolean }>;
  home: string;
  repoRoot: string;
  log: (line: string) => void;
  now: () => number;
  /** Size of one Drive range read when fetching an entry (default 8 MiB). */
  chunkBytes?: number;
  /** The repository's git common directory (the main checkout's `.git`), when this module runs from a worktree. */
  commonDir?: () => Promise<string | null>;
  /** Creates a hard link, failing if the target exists (default `Deno.link`). A seam so tests can fail a step. */
  link?: (from: string, to: string) => Promise<void>;
  /** Called after the cached entry was verified and before it is parsed (a seam for tests). */
  afterCacheVerified?: (path: string) => Promise<void>;
}

// ---- paths ----

/** The path with symlinks resolved as far as it exists, so a link into the repository is seen as the repository. */
async function realish(p: string): Promise<string> {
  let cur = resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return join(await Deno.realPath(cur), ...rest.reverse());
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
      const parent = dirname(cur);
      if (parent === cur) return resolve(p);
      rest.push(basename(cur));
      cur = parent;
    }
  }
}

const within = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel));
};

/**
 * Refuses a path inside any checkout of this repository: this module's own root, the main checkout (the parent of the
 * git common directory, which differs when running from a worktree), or any directory with a `.git` entry among its
 * ancestors. Symlinks are resolved first; a path that does not exist yet is judged by its nearest existing ancestor.
 */
export async function refuseInCheckout(
  path: string,
  what: string,
  deps: Pick<PackDeps, 'repoRoot' | 'commonDir'>,
): Promise<string> {
  const target = await realish(path);
  const roots = [await realish(deps.repoRoot)];
  const common = deps.commonDir ? await deps.commonDir() : null;
  if (common) roots.push(await realish(dirname(common)));
  const fail = (why: string) => {
    throw new Error(
      `${what} must be outside the repository and every other checkout of it, not ${resolve(path)} (${why})`,
    );
  };
  if (roots.some((r) => within(r, target))) fail('inside a checkout of this repository');
  for (let cur = target;;) {
    if (await exists(join(cur, '.git'))) fail(`${cur} holds a .git entry`);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return resolve(path);
}

export const exists = (p: string) => Deno.lstat(p).then(() => true, () => false);

// ---- pack on Drive ----

interface Manifest {
  files: Record<string, { bytes: number; sha256: string }>;
}

interface OpenPack {
  zip: DriveItem & { size: number };
  /** sha256 of manifest.json as read. */
  manifestSha256: string;
  read: ReadRange;
  entries: ZipEntry[];
  manifest: Manifest;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let n = 0;
  for await (const c of stream) {
    parts.push(c);
    n += c.length;
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function openPack(drive: DriveClient, pack: string): Promise<OpenPack> {
  const folder = await drive.folderByPath(pack);
  const sub = (await drive.children(folder.id)).filter((i) => i.name === SUBFOLDER);
  if (sub.length !== 1) throw new Error(`${pack} has ${sub.length} folders named "${SUBFOLDER}", expected one`);
  const zips = (await drive.children(sub[0].id)).filter((i) => ZIP_NAME.test(i.name));
  if (zips.length !== 1) throw new Error(`${pack}/${SUBFOLDER} has ${zips.length} pack zips, expected one`);
  const zip = zips[0];
  if (zip.size === undefined || !Number.isSafeInteger(zip.size)) throw new Error(`Drive gave no size for ${zip.name}`);
  const read: ReadRange = (s, e) => drive.readRange(zip.id, s, e);
  const entries = await readDirectory(zip.size, read);
  // v1.1 to v1.6 carry manifest.json; the v1.2 delta carries manifest_delta.json (same files table). Exactly one.
  const found = MANIFEST_NAMES.map((n) => entries.find((e) => e.name === PREFIX + n)).filter((e) => e !== undefined);
  if (found.length !== 1) {
    throw new Error(
      `${zip.name} must hold exactly one of ${MANIFEST_NAMES.join(', ')} under ${PREFIX}, not ${found.length}`,
    );
  }
  const m = found[0];
  if (m.size > MAX_MANIFEST_BYTES) throw new Error('the manifest is implausibly large');
  let manifest: Manifest;
  const manifestBytes = await collect(entryStream(m, read));
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error('manifest.json is not valid JSON');
  }
  const files = manifest?.files;
  if (!files || typeof files !== 'object') throw new Error('manifest.json has no files table');
  for (const [name, f] of Object.entries(files)) {
    if (!Number.isSafeInteger(f?.bytes) || !/^[0-9a-f]{64}$/.test(f?.sha256 ?? '')) {
      throw new Error(`manifest.json entry ${name} lacks bytes or sha256`);
    }
  }
  return {
    zip: { ...zip, size: zip.size },
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    read,
    entries,
    manifest,
  };
}

// ---- files: writing and hashing without holding whole entries ----

export async function writeAll(file: Deno.FsFile, chunk: Uint8Array): Promise<void> {
  for (let o = 0; o < chunk.length;) o += await file.write(chunk.subarray(o));
}

/** Streams to a new file while hashing it. */
async function streamToFile(stream: ReadableStream<Uint8Array>, path: string) {
  const file = await Deno.open(path, { write: true, createNew: true });
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      hash.update(chunk);
      bytes += chunk.length;
      await writeAll(file, chunk);
    }
  } finally {
    file.close();
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function hashFile(path: string) {
  const file = await Deno.open(path, { read: true });
  return await streamToHash(file.readable);
}

async function streamToHash(stream: ReadableStream<Uint8Array>) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

/**
 * Lines as the bytes they were, without their newline; a last line needs no newline. A line that spans many chunks is
 * collected as pieces and joined once. Any failure of the stream is reported as an invalid gzip stream (fail closed).
 */
export async function* lines(stream: ReadableStream<Uint8Array>, name: string): AsyncGenerator<Uint8Array> {
  let pieces: Uint8Array[] = [];
  let length = 0;
  const join = (last: Uint8Array): Uint8Array => {
    if (pieces.length === 0) return last;
    const out = new Uint8Array(length + last.length);
    let at = 0;
    for (const p of pieces) {
      out.set(p, at);
      at += p.length;
    }
    out.set(last, at);
    pieces = [];
    length = 0;
    return out;
  };
  try {
    for await (const chunk of stream) {
      let from = 0;
      for (let i = chunk.indexOf(10, from); i >= 0; i = chunk.indexOf(10, from)) {
        yield join(chunk.subarray(from, i));
        from = i + 1;
      }
      if (from < chunk.length) {
        const rest = chunk.slice(from);
        pieces.push(rest);
        length += rest.length;
      }
    }
  } catch {
    throw new Error(`the gzip stream of ${name} is invalid (damaged, truncated, or more than one member)`);
  }
  if (length > 0) yield join(new Uint8Array(0));
}

// ---- commands ----

const DROPS = ['not_servable', 'licence_barred', 'replacement', 'skipped_key', 'duplicate_key', 'over_limit'] as const;
type Drop = typeof DROPS[number];

const home = (deps: PackDeps, key: string | null) => key ?? join(deps.home, '.config/niyantran/drive-reader.json');

async function list(c: Extract<Command, { cmd: 'list' }>, deps: PackDeps): Promise<number> {
  const pack = checkPack(c.pack);
  const p = await openPack(await deps.drive(home(deps, c.key)), pack);
  deps.log(`pack ${pack}`);
  deps.log(`zip ${p.zip.name}  ${p.zip.size} bytes  drive sha256 ${p.zip.sha256Checksum ?? '(none)'}`);
  for (const e of p.entries) {
    if (e.name.endsWith('/')) continue;
    const rel = e.name.startsWith(PREFIX) ? e.name.slice(PREFIX.length) : e.name;
    const m = e.name.startsWith(PREFIX) ? p.manifest.files[rel] : undefined;
    deps.log(`${rel}  ${e.size}  ${m ? m.sha256 : '(not in manifest)'}`);
  }
  return 0;
}

async function select(c: Extract<Command, { cmd: 'select' }>, deps: PackDeps): Promise<number> {
  const pack = checkPack(c.pack);
  const entryName = checkEntry(c.entry);
  const out = await refuseInCheckout(c.out, '--out', deps);
  const cacheDir = await refuseInCheckout(c.cache ?? join(deps.home, 'niyantran-packs', pack), '--cache', deps);
  const receiptPath = `${out}.receipt.json`;
  for (const p of [out, receiptPath]) if (await exists(p)) throw new Error(`${p} already exists; choose a new --out`);
  const skip = new Set<string>();
  let skipSha: string | null = null;
  if (c.skipKeys) {
    const raw = await Deno.readFile(c.skipKeys);
    skipSha = createHash('sha256').update(raw).digest('hex');
    for (const l of new TextDecoder().decode(raw).split('\n')) if (l.trim()) skip.add(l.trim());
  }
  const startedAt = new Date(deps.now()).toISOString();
  const { commit, dirty } = await deps.git();

  const p = await openPack(await deps.drive(home(deps, c.key)), pack);
  deps.log(`pack ${pack}: ${p.zip.name}, ${p.zip.size} bytes`);
  const want = p.manifest.files[entryName];
  if (!want) throw new Error(`${entryName} is not in the pack's manifest`);
  const zipEntry = p.entries.find((e) => e.name === PREFIX + entryName);
  if (!zipEntry) throw new Error(`${entryName} is in the manifest but not in the zip`);
  if (zipEntry.size !== want.bytes) {
    throw new Error(`${entryName}: the zip says ${zipEntry.size} bytes, the manifest says ${want.bytes}`);
  }

  // The entry, in the cache, checked against the manifest. A cached file is reused only if its hash still matches.
  const tag = crypto.randomUUID().slice(0, 8);
  const cached = join(cacheDir, entryName);
  let have = false;
  if (await exists(cached)) {
    const h = await hashFile(cached);
    have = h.sha256 === want.sha256 && h.bytes === want.bytes;
    if (!have) deps.log(`cache: ${cached} does not match the manifest; fetching again`);
  }
  if (have) {
    deps.log(`cache: reusing ${cached}`);
  } else {
    await Deno.mkdir(dirname(cached), { recursive: true });
    const part = `${cached}.part-${tag}`;
    try {
      const got = await streamToFile(entryStream(zipEntry, p.read, deps.chunkBytes), part);
      if (got.sha256 !== want.sha256 || got.bytes !== want.bytes) {
        throw new Error(
          `${entryName}: sha256 ${got.sha256} (${got.bytes} bytes) does not match the manifest's ${want.sha256} (${want.bytes} bytes)`,
        );
      }
      await Deno.rename(part, cached);
    } catch (e) {
      await Deno.remove(part).catch(() => {});
      throw e;
    }
    deps.log(`cache: fetched ${entryName} (${want.bytes} bytes) to ${cached}, sha256 matches the manifest`);
  }
  await deps.afterCacheVerified?.(cached);

  // One pass over the cached bytes: hash them, decompress them, parse them, keep or drop. The hash is compared with the
  // manifest before anything is published, so the bytes that were parsed are the bytes that were verified.
  await Deno.mkdir(dirname(out), { recursive: true });
  const tmpOut = `${out}.part-${tag}`;
  const tmpReceipt = `${receiptPath}.part-${tag}`;
  const link = deps.link ?? ((from: string, to: string) => Deno.link(from, to));
  const created: string[] = [];
  try {
    const counts: Record<Drop, number> = Object.fromEntries(DROPS.map((d) => [d, 0])) as Record<Drop, number>;
    const seen = new Set<string>();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const outHash = createHash('sha256');
    const inHash = createHash('sha256');
    let inBytes = 0;
    const NL = new Uint8Array([10]);
    const file = await Deno.open(tmpOut, { write: true, createNew: true });
    let read = 0;
    let written = 0;
    let outBytes = 0;
    try {
      const source = (await Deno.open(cached, { read: true })).readable
        .pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              inHash.update(chunk);
              inBytes += chunk.length;
              controller.enqueue(chunk);
            },
          }),
        )
        .pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
      for await (const bytes of lines(source, entryName)) {
        read++;
        let r: Record<string, unknown>;
        try {
          r = JSON.parse(decoder.decode(bytes));
        } catch {
          throw new Error(`line ${read}: not JSON`);
        }
        if (r === null || typeof r !== 'object' || Array.isArray(r)) throw new Error(`line ${read}: not a JSON object`);
        if (typeof r.schema !== 'string' || !r.schema.startsWith(SCHEMA_PREFIX)) {
          throw new Error(`line ${read}: schema is not ${SCHEMA_PREFIX}*`);
        }
        if (typeof r.source_key !== 'string' || r.source_key === '') throw new Error(`line ${read}: no source_key`);
        const key = r.source_key;
        // A key seen on any earlier line counts, even if that line was dropped by another rule (conservative).
        const dup = seen.has(key);
        seen.add(key);
        let drop: Drop | null = null;
        if (r.servable === false) drop = 'not_servable';
        else if (typeof r.licence_class === 'string' && r.licence_class.startsWith('BARRED_')) drop = 'licence_barred';
        else if (r.v16_replaces === true) drop = 'replacement';
        else if (skip.has(key)) drop = 'skipped_key';
        else if (dup) drop = 'duplicate_key';
        else if (c.limit !== null && written >= c.limit) drop = 'over_limit';
        if (drop) {
          counts[drop]++;
          continue;
        }
        for (const part of [bytes, NL]) {
          await writeAll(file, part);
          outHash.update(part);
          outBytes += part.length;
        }
        written++;
      }
    } finally {
      file.close();
    }
    const summary = `lines_read ${read}, dropped ${
      DROPS.map((d) => `${d} ${counts[d]}`).join(', ')
    }, lines_written ${written}`;
    if (read === 0) throw new Error(`${entryName} holds no lines`);
    if (inHash.digest('hex') !== want.sha256 || inBytes !== want.bytes) {
      throw new Error(`${entryName}: the cached file changed after it was verified; nothing was written`);
    }
    if (written === 0) {
      deps.log(summary);
      throw new Error(`no line of ${entryName} was kept; nothing was written`);
    }
    const outSha = outHash.digest('hex');
    const receipt = {
      pack,
      zip: { id: p.zip.id, name: p.zip.name, size: p.zip.size, drive_sha256: p.zip.sha256Checksum ?? null },
      entry: entryName,
      manifest_sha256: want.sha256,
      manifest_verified: true,
      manifest_json_sha256: p.manifestSha256,
      lines_read: read,
      dropped: counts,
      lines_written: written,
      output_bytes: outBytes,
      output_sha256: outSha,
      limit: c.limit,
      skip_keys: skip.size,
      skip_keys_sha256: skipSha,
      reader_commit: commit,
      reader_dirty: dirty,
      started_at: startedAt,
      finished_at: new Date(deps.now()).toISOString(),
    };
    // Both targets are created exclusively, by hard link. The receipt goes first: a stop between the two leaves an
    // orphan receipt, never a records file without one.
    await Deno.writeTextFile(tmpReceipt, JSON.stringify(receipt, null, 2) + '\n', { createNew: true });
    await link(tmpReceipt, receiptPath);
    created.push(receiptPath);
    await Deno.remove(tmpReceipt);
    await link(tmpOut, out);
    created.push(out);
    await Deno.remove(tmpOut);
    deps.log(summary);
    deps.log(`wrote ${out} (${outBytes} bytes, sha256 ${outSha}) and ${receiptPath}`);
    return 0;
  } catch (e) {
    await Deno.remove(tmpOut).catch(() => {});
    await Deno.remove(tmpReceipt).catch(() => {});
    for (const path of created) await Deno.remove(path).catch(() => {});
    throw e;
  }
}

/** Runs one command; returns the process exit code. */
export function main(argv: string[], deps: PackDeps): Promise<number> {
  const c = parseArgs(argv);
  return c.cmd === 'list' ? list(c, deps) : select(c, deps);
}

export async function gitState(): Promise<{ commit: string; dirty: boolean }> {
  const git = async (...args: string[]) => {
    const out = await new Deno.Command('git', { args: ['-C', REPO_ROOT, ...args], stdout: 'piped' }).output();
    if (out.code !== 0) throw new Error(`git ${args[0]} failed`);
    return new TextDecoder().decode(out.stdout).trim();
  };
  return {
    commit: await git('rev-parse', 'HEAD'),
    dirty: (await git('status', '--porcelain', '--', 'scripts/bulk-runner')) !== '',
  };
}

/** The main checkout's `.git` as an absolute path, or null when git cannot say. */
export async function gitCommonDir(): Promise<string | null> {
  const out = await new Deno.Command('git', {
    args: ['-C', REPO_ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    stdout: 'piped',
    stderr: 'null',
  }).output();
  return out.code === 0 ? new TextDecoder().decode(out.stdout).trim() || null : null;
}

if (import.meta.main) {
  try {
    const homeDir = Deno.env.get('HOME');
    if (!homeDir) throw new Error('HOME is not set');
    Deno.exit(
      await main(Deno.args, {
        drive: async (keyPath) =>
          createDriveClient(parseKey(await Deno.readTextFile(keyPath)), {
            fetch: (...a) => fetch(...a),
            now: () => Date.now(),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          }),
        git: gitState,
        home: homeDir,
        repoRoot: REPO_ROOT,
        commonDir: gitCommonDir,
        log: (l) => console.log(l),
        now: () => Date.now(),
      }),
    );
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  }
}
