// ADR 0005: nothing durable is written under /tmp on a serverless host.
// On Vercel, writablePath() is /tmp/niyantran, which is per instance and lost
// on cold starts, so a module that a Vercel function (api/**) can reach may
// use it only for data that is safe to lose. This walks the functions'
// relative imports statically (running them needs secrets) and fails on any
// durable use, and on any use it cannot follow.
// Spec: docs/specs/2026-09-28-t0-serverless-durability-guard.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_DIR = 'api';
const DB_MODULE = 'server/db.mjs';
const WRITABLE_ROOT_MODULE = 'server/writableRoot.mjs';

// Keys whose contents are caches and safe to lose (spec C1, C2). Never add a
// durable store here to get green.
const CACHE_KEYS = new Set(['desk-briefs', 'stat1.xlsx']);

// Offences that exist today, each removed by the task that moves its store to
// Supabase. The list may only shrink: a new offence fails, and so does an
// entry whose offence is gone.
const KNOWN_OFFENDERS = {
  'server/billingApi.mjs imports server/db.mjs': 'S6 invoices (T5)',
  "server/nterNews.mjs writes writablePath('nter-news.json')": 'S7 nter.news (T6)',
  'server/deskBrief.mjs imports server/db.mjs': 'C1 entry_briefs cache tier on SQLite (T7)',
  "server/db.mjs writes writablePath('niyantran.sqlite')": 'the SQLite file itself (T7)',
};

const SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"]([^'"\n]+)['"]/g;
const WRITABLE_CALL = /\b(writablePath|writableRoot)\s*\(([^)]*)\)/g;
const WRITABLE_ALIAS = /\b(writablePath|writableRoot)\s+as\s+\w+/g;
const WRITABLE_REFERENCE = /\b(writablePath|writableRoot)\b(?!\s*\()/g;
const NAMED_IMPORT = /\bimport\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g;
const TEMP_DIRECTORY = /\bos\.tmpdir\b|\btmpdir\s*\(|\bprocess\.env\.TMPDIR\b|['"`]\/tmp\b/;
// Whole-line comments only: stripping trailing comments would need a
// tokenizer to tell `//` in a URL string from a comment.
const LINE_COMMENT = /^\s*\/\/.*$/gm;
const BLOCK_COMMENT = /^\s*\/\*[\s\S]*?\*\//gm;
const EXTENSIONS = ['', '.js', '.mjs', '.jsx', '/index.js'];

function resolveRelative(from, specifier, exists) {
  const base = path.posix.join(path.posix.dirname(from), specifier);
  return EXTENSIONS.map((ext) => base + ext).find(exists) ?? null;
}

function withoutComments(source) {
  return source.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
}

function offencesIn(file, source) {
  if (file === WRITABLE_ROOT_MODULE) return [];
  const found = [];
  for (const [, fn, args] of source.matchAll(WRITABLE_CALL)) {
    const literal = fn === 'writablePath' ? /^\s*(['"])([^'"]+)\1/.exec(args) : null;
    if (!literal) {
      found.push(`${file} calls ${fn}() with a key the guard cannot read`);
    } else if (args.includes('..') || !CACHE_KEYS.has(literal[2].split('/')[0])) {
      found.push(`${file} writes writablePath(${args.trim()})`);
    }
  }
  for (const [, fn] of source.matchAll(WRITABLE_ALIAS)) found.push(`${file} aliases ${fn}`);
  for (const [, fn] of source.replace(NAMED_IMPORT, '').matchAll(WRITABLE_REFERENCE)) {
    found.push(`${file} uses ${fn} without calling it`);
  }
  if (TEMP_DIRECTORY.test(source)) found.push(`${file} reaches the temp directory without writablePath`);
  return found;
}

function scan(entries, { read, exists }) {
  const reached = new Set();
  const offences = [];
  const unresolved = [];
  const queue = [].concat(entries);
  while (queue.length) {
    const file = queue.shift();
    if (reached.has(file)) continue;
    reached.add(file);
    const source = withoutComments(read(file));
    offences.push(...offencesIn(file, source));
    for (const [, specifier] of source.matchAll(SPECIFIER)) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
      const target = resolveRelative(file, specifier, exists);
      if (!target) {
        unresolved.push(`${file} -> ${specifier}`);
        continue;
      }
      if (target === DB_MODULE && file !== DB_MODULE) offences.push(`${file} imports ${DB_MODULE}`);
      queue.push(target);
    }
  }
  return { reached, offences: [...new Set(offences)].sort(), unresolved };
}

const repo = {
  read: (file) => fs.readFileSync(path.join(ROOT, file), 'utf8'),
  exists: (file) => {
    try {
      return fs.statSync(path.join(ROOT, file)).isFile();
    } catch {
      return false;
    }
  },
};

function apiEntries(dir = API_DIR) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((dirent) => {
    const file = path.posix.join(dir, dirent.name);
    if (dirent.isDirectory()) return apiEntries(file);
    return /\.m?js$/.test(dirent.name) ? [file] : [];
  });
}

function memory(files) {
  return { read: (file) => files[file], exists: (file) => Object.hasOwn(files, file) };
}

describe('scan', () => {
  it('flags an import of the SQLite store and the durable key it writes', () => {
    const result = scan('api/router.js', memory({
      'api/router.js': "import { handle } from '../server/prefs.mjs';",
      'server/prefs.mjs': "import { getDb } from './db.mjs';",
      'server/db.mjs': "import { writablePath } from './writableRoot.mjs';\nconst p = writablePath('niyantran.sqlite');",
      'server/writableRoot.mjs': 'export function writablePath(...parts) { return parts; }',
    }));
    expect(result.offences).toEqual([
      "server/db.mjs writes writablePath('niyantran.sqlite')",
      'server/prefs.mjs imports server/db.mjs',
    ]);
  });

  it('allows cache keys and flags every other key, including unreadable ones', () => {
    const result = scan('a.mjs', memory({
      'a.mjs': [
        "writablePath('desk-briefs')",
        "writablePath('stat1.xlsx')",
        "writablePath('app-flags.json')",
        'writablePath(name)',
        'writableRoot()',
      ].join(';\n'),
    }));
    expect(result.offences).toEqual([
      'a.mjs calls writablePath() with a key the guard cannot read',
      'a.mjs calls writableRoot() with a key the guard cannot read',
      "a.mjs writes writablePath('app-flags.json')",
    ]);
  });

  it('follows dynamic imports and re-exports, and ignores packages', () => {
    const result = scan('a.js', memory({
      'a.js': "import x from 'zod';\nexport { y } from './b.js';\nconst c = await import('./c');",
      'b.js': "writablePath('b.json')",
      'c.mjs': "writablePath('c.json')",
    }));
    expect([...result.reached].sort()).toEqual(['a.js', 'b.js', 'c.mjs']);
    expect(result.offences).toEqual(["b.js writes writablePath('b.json')", "c.mjs writes writablePath('c.json')"]);
  });

  it('reports a relative import it cannot resolve', () => {
    expect(scan('a.js', memory({ 'a.js': "import './missing.js';" })).unresolved).toEqual(['a.js -> ./missing.js']);
  });

  it('flags aliased and indirect uses it cannot follow', () => {
    const result = scan('a.mjs', memory({
      'a.mjs': [
        "import { writablePath as wp, writableRoot } from './server/writableRoot.mjs';",
        "const users = wp('users.json');",
        "const dir = path.join(writableRoot(), 'x');",
        'const alias = writableRoot;',
      ].join('\n'),
      'server/writableRoot.mjs': 'export function writablePath(...parts) { return parts; }',
    }));
    expect(result.offences).toEqual([
      'a.mjs aliases writablePath',
      'a.mjs calls writableRoot() with a key the guard cannot read',
      'a.mjs uses writableRoot without calling it',
    ]);
  });

  it('flags temp-directory paths that bypass writablePath', () => {
    const result = scan('a.mjs', memory({
      'a.mjs': "const a = path.join(os.tmpdir(), 'u.json');\nconst b = process.env.TMPDIR;\nconst c = '/tmp/u.json';",
    }));
    expect(result.offences).toEqual(['a.mjs reaches the temp directory without writablePath']);
  });

  it('flags a cache key that climbs out of its directory', () => {
    const result = scan('a.mjs', memory({
      'a.mjs': "writablePath('desk-briefs/../users.json');\nwritablePath('desk-briefs', '../users.json');",
    }));
    expect(result.offences).toEqual([
      "a.mjs writes writablePath('desk-briefs', '../users.json')",
      "a.mjs writes writablePath('desk-briefs/../users.json')",
    ]);
  });

  it('ignores whole-line comments', () => {
    const result = scan('a.js', memory({
      'a.js': "// import old from './gone.js';\n/*\n * writablePath('users.json')\n */\nconst ok = 1;",
    }));
    expect(result).toMatchObject({ offences: [], unresolved: [] });
  });

  it('walks every entry it is given', () => {
    const result = scan(['api/a.js', 'api/b.js'], memory({ 'api/a.js': '', 'api/b.js': "writablePath('b.json')" }));
    expect(result.offences).toEqual(["api/b.js writes writablePath('b.json')"]);
  });
});

describe('serverless durability of the Vercel functions', () => {
  const entries = apiEntries();
  const result = scan(entries, repo);

  it('walks the handlers the router serves', () => {
    expect(entries).toContain('api/router.js');
    for (const file of [DB_MODULE, WRITABLE_ROOT_MODULE, 'server/userPrefsApi.mjs', 'server/deskBrief.mjs']) {
      expect(result.reached.has(file), file).toBe(true);
    }
    expect(result.unresolved).toEqual([]);
  });

  it('writes nothing durable under writablePath() beyond the known offenders', () => {
    expect(result.offences.filter((offence) => !Object.hasOwn(KNOWN_OFFENDERS, offence))).toEqual([]);
  });

  it('lists no known offender whose offence is gone', () => {
    expect(Object.keys(KNOWN_OFFENDERS).filter((offence) => !result.offences.includes(offence))).toEqual([]);
  });
});
