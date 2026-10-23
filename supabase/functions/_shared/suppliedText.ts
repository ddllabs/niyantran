// Admission adapter only. Chunk boundaries and embedding context belong to textContext.ts.
import { dedupeChunkRows } from './chunking.ts';
import { DESK_CATALOG } from './deskCatalog.ts';
import { chunkTextWithContext } from './textContext.ts';
import { sha256Hex } from './textNormalise.ts';

export const SUPPLIED_TEXT = Object.freeze({ maxChars: 600_000, maxChunks: 800, bodyBytes: 4_000_000, version: 1 });
const SHA = /^[a-f0-9]{64}$/;
function object(v: unknown, name: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${name} must be an object`);
  return v as Record<string, unknown>;
}
function string(v: unknown, name: string, max = 1000): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) throw new Error(`invalid ${name}`);
  return v;
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) =>
      JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])
    ).join(',') + '}';
  }
  return JSON.stringify(v);
}
export async function prepareSuppliedText(value: unknown) {
  const r = object(value, 'record');
  if (r.adapter_version !== undefined && r.adapter_version !== SUPPLIED_TEXT.version) throw new Error('unsupported adapter version');
  const source_key = string(r.source_key, 'source_key');
  if (!source_key.startsWith('law:')) throw new Error('this adapter requires a Law source_key');
  const title = string(r.title, 'title', 300);
  const text = string(r.text, 'text', SUPPLIED_TEXT.maxChars);
  if (!text.isWellFormed()) throw new Error('text has invalid Unicode');
  const hash = await sha256Hex(text);
  if (r.text_sha256 !== hash || (r.content_sha256 !== undefined && r.content_sha256 !== hash)) {
    throw new Error('text hash mismatch');
  }
  if (!DESK_CATALOG.some((e) => e.tier === r.desk_tier && e.feature === r.desk_feature) || r.desk_tier !== 'law') {
    throw new Error('unsupported desk feature');
  }
  if (r.text_quality !== undefined && r.text_quality !== 'ok') throw new Error('incomplete or unreviewed text quality');
  if (r.page_split != null && !['exact', 'none'].includes(String(r.page_split))) {
    throw new Error('incomplete or unsupported page split');
  }
  const review = object(r.review, 'review');
  if (review.status !== 'eligible' || review.text_sha256 !== hash || review.source_key !== source_key) {
    throw new Error('review does not bind this source and text');
  }
  if (!SHA.test(String(review.rules_sha256))) throw new Error('review rules hash required');
  const checks = object(review.checks, 'review checks');
  for (const name of ['identity', 'completeness', 'sensitivity', 'dedupe', 'rights']) {
    if (checks[name] !== true) throw new Error(`review ${name} has not passed`);
  }
  const checkedReview = {
    status: 'eligible',
    source_key,
    text_sha256: hash,
    rules_sha256: review.rules_sha256,
    package_id: string(review.package_id, 'review package'),
    mapping_version: string(review.mapping_version, 'review mapping version'),
    decision_id: string(review.decision_id, 'review decision'),
    checks: { identity: true, completeness: true, sensitivity: true, dedupe: true, rights: true },
  };
  const citation = object(r.citation, 'citation');
  if (!Object.keys(citation).length) throw new Error('citation is empty');
  // One pass builds code-point -> UTF-16 boundaries, including the final boundary.
  const offsets = [0];
  let pos = 0;
  for (const c of text) {
    pos += c.length;
    offsets.push(pos);
  }
  if (r.n_chars != null && r.n_chars !== offsets.length - 1) throw new Error('n_chars mismatch');
  function spans(raw: unknown, kind: 'page' | 'section') {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 20_000) throw new Error(`invalid ${kind} spans`);
    let end = 0;
    const numbers = new Set<number>();
    return raw.map((v) => {
      const s = object(v, kind);
      const a = s.char_from as number;
      const b = s.char_to as number;
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < a || b >= offsets.length) {
        throw new Error(`invalid ${kind} span`);
      }
      if (kind === 'page') {
        if (
          a < end || !Number.isSafeInteger(s.page_number) || Number(s.page_number) < 1 ||
          numbers.has(Number(s.page_number))
        ) throw new Error('overlapping or duplicate page');
        numbers.add(Number(s.page_number));
        end = b;
        if (s.text !== undefined && s.text !== text.slice(offsets[a], offsets[b])) {
          throw new Error('page text mismatch');
        }
      }
      return {
        ...(kind === 'page'
          ? { page_number: s.page_number }
          : { section_number: s.section_number ?? null, heading: s.heading ?? null }),
        source_char_from: a,
        source_char_to: b,
        char_from: offsets[a],
        char_to: offsets[b],
      };
    });
  }
  const pages = spans(r.pages, 'page');
  const sections = spans(r.sections, 'section');
  for (const count of [r.n_pages, r.page_count]) {
    if (count != null && count !== pages.length) throw new Error('page count mismatch');
  }
  const input: Record<string, unknown> = {
    adapter_version: SUPPLIED_TEXT.version,
    source_key,
    title,
    text,
    text_sha256: hash,
    desk_tier: r.desk_tier,
    desk_feature: r.desk_feature,
    citation,
    review: checkedReview,
    pages: r.pages ?? [],
    sections: r.sections ?? [],
  };
  for (const k of ['n_chars', 'n_pages', 'page_count', 'page_split', 'text_quality']) if (r[k] != null) input[k] = r[k];
  if (review.file_sha256 !== undefined) {
    if (!SHA.test(String(review.file_sha256))) throw new Error('review file hash required');
    (input.review as Record<string, unknown>).file_sha256 = review.file_sha256;
  }
  for (
    const k of [
      'document_key_suggested',
      'doc_type',
      'pack',
      'schema',
      'as_of',
      'source_host',
      'text_engine',
      'ocr_lang',
      'file_name',
      'file_url',
      'file_url_alt',
      'source_path',
      'source_archive_url',
      'language',
      'extraction',
      'licence',
      'licence_class',
      'attribution',
      'citation_text',
    ]
  ) {
    if (r[k] != null) input[k] = string(r[k], k, 4000);
  }
  for (const k of ['file_url', 'file_url_alt', 'source_archive_url']) {
    if (input[k]) {
      const u = new URL(String(input[k]));
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error(`invalid ${k}`);
    }
  }
  const chunks = dedupeChunkRows(await chunkTextWithContext(text));
  if (!chunks.length || chunks.length > SUPPLIED_TEXT.maxChunks) {
    throw new Error('chunk limit: hold document without truncation');
  }
  const payload = canonical(input);
  if (new TextEncoder().encode(payload).length > SUPPLIED_TEXT.bodyBytes - 100_000) {
    throw new Error('payload too large');
  }
  return { input, text, pages, sections, chunks, payload, payload_sha256: await sha256Hex(payload) };
}
