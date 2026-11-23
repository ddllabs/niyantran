// Relinking a records file (F390): the file links of some records are replaced from a map of checked new links, before
// the screen. cli.ts `relink` reads and checks the files and writes the output and its receipt; this module holds the
// rules a map line must meet and builds the output lines. Nothing here reads a file, the network or a database.
//
// A map line is taken only when every rule holds; one line that breaks a rule refuses the whole run, so no output is a
// partial relink. The screen still page-checks every new link against its official PDF rule: the map is a claim that
// the screen tests, not a pass.
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';

type Rec = Record<string, unknown>;

const HEX40 = /^[0-9a-f]{40}$/;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** What a relinked record carries beside its new file_url: the link it had and the map line that changed it. */
export interface RelinkProvenance {
  from: string;
  map_sha256: string;
  map_line_sha256: string;
}

export const PROVENANCE_FIELD = 'file_url_relinked';

export interface RelinkResult {
  /** The output, one record per line, each ending in "\n". */
  body: string;
  counts: { read: number; relinked: number; unchanged: number };
  /** Map lines that held an entry (blank lines are skipped). */
  mapLines: number;
}

/** A map refused: every rule broken, by line and key. The message names keys and rules, never a link. */
export class RelinkError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `relink refused, nothing written: ${problems.length} problem${problems.length > 1 ? 's' : ''}\n  ` +
        problems.slice(0, 50).join('\n  ') + (problems.length > 50 ? `\n  ... and ${problems.length - 50} more` : ''),
    );
    this.name = 'RelinkError';
  }
}

/**
 * A new link the runner accepts: https, no user or password, no port, no query or fragment (not even an empty `?` or
 * `#`), a path ending in .pdf, and written exactly as the URL parser writes it back, so what the screen and the database
 * compare is what the map says.
 */
export function acceptableUrl(v: unknown): boolean {
  if (typeof v !== 'string' || v.includes('?') || v.includes('#')) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.username === '' && u.password === '' && u.port === '' && u.search === '' &&
    u.hash === '' && /\.pdf$/i.test(u.pathname) && u.href === v;
}

/** The record lines of a records text as parseRecords finds them: split on "\n", blank lines dropped, each kept as is. */
const recordLines = (text: string) => text.split('\n').filter((l) => l.trim());

/**
 * Builds the relinked records. `recordsText` must already be checked against its receipt (cli.ts readRecordsText);
 * `mapText` is the map file as UTF-8 and `mapSha256` the hash of its bytes. Unmapped lines are kept byte for byte; a
 * mapped record is parsed, its file_url replaced in place and the provenance added as its last field.
 */
export async function relink(recordsText: string, mapText: string, mapSha256: string): Promise<RelinkResult> {
  const problems: string[] = [];
  const lines = recordLines(recordsText);
  const records = lines.map((l) => JSON.parse(l) as unknown);
  const byKey = new Map<string, number[]>();
  records.forEach((r, i) => {
    if (isRec(r) && typeof r.source_key === 'string') byKey.set(r.source_key, [...(byKey.get(r.source_key) ?? []), i]);
  });

  const changes = new Map<number, { url: string; prov: RelinkProvenance }>();
  const seenKeys = new Set<string>();
  const seenUrls = new Map<string, string>();
  let mapLines = 0;
  const raw = mapText.split('\n');
  for (let n = 0; n < raw.length; n++) {
    const line = raw[n];
    if (!line.trim()) continue;
    mapLines++;
    const at = `map line ${n + 1}`;
    let m: unknown;
    try {
      m = JSON.parse(line);
    } catch {
      m = null;
    }
    if (!isRec(m)) {
      problems.push(`${at}: not a JSON object`);
      continue;
    }
    const key = m.source_key;
    if (typeof key !== 'string' || !HEX40.test(key)) {
      problems.push(`${at}: source_key is not 40 lowercase hex characters`);
      continue;
    }
    const fail = (rule: string) => problems.push(`${at} (source_key ${key}): ${rule}`);
    if (seenKeys.has(key)) {
      fail('source_key appears more than once in the map');
      continue;
    }
    seenKeys.add(key);
    const at_ = byKey.get(key) ?? [];
    if (at_.length === 0) {
      fail('source_key is not in the records');
      continue;
    }
    if (at_.length > 1) {
      fail('source_key appears more than once in the records');
      continue;
    }
    const rec = records[at_[0]] as Rec;
    const before = problems.length;
    if (!acceptableUrl(m.new_url)) {
      fail('new_url must be https, with no query, fragment, user or port, and a path ending .pdf');
    }
    if (m.http_status !== 200) fail('http_status must be 200');
    if (m.content_type !== 'application/pdf') fail('content_type must be application/pdf');
    if (!Number.isSafeInteger(rec.file_bytes)) fail('the record has no file_bytes to compare bytes with');
    else if (m.bytes !== rec.file_bytes) fail("bytes must equal the record's file_bytes");
    if (typeof rec.file_url !== 'string' || rec.file_url === '') fail('the record has no file_url to replace');
    // Its first relink's record of the link it replaced would be lost: relink the pack reader's records instead.
    if (Object.hasOwn(rec, PROVENANCE_FIELD)) fail(`the record already carries ${PROVENANCE_FIELD}`);
    if (problems.length > before) continue;
    const url = m.new_url as string;
    if (url === rec.file_url) {
      fail("new_url is already the record's file_url");
      continue;
    }
    const other = seenUrls.get(url);
    if (other !== undefined) {
      fail(`new_url is the new_url of another map line (source_key ${other})`);
      continue;
    }
    seenUrls.set(url, key);
    changes.set(at_[0], {
      url,
      prov: { from: rec.file_url as string, map_sha256: mapSha256, map_line_sha256: await sha256Hex(line) },
    });
  }
  if (mapLines === 0) problems.push('the map holds no lines');
  if (problems.length) throw new RelinkError(problems);

  const out = lines.map((l, i) => {
    const c = changes.get(i);
    if (!c) return l;
    const r = { ...(records[i] as Rec), file_url: c.url, [PROVENANCE_FIELD]: c.prov };
    return JSON.stringify(r);
  });
  return {
    body: out.map((l) => l + '\n').join(''),
    counts: { read: lines.length, relinked: changes.size, unchanged: lines.length - changes.size },
    mapLines,
  };
}
