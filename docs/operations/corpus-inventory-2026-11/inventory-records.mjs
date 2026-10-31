// Corpus inventory, pass 2: per-record facts with the repository chunker. Read-only; no network.
// Status: Living (2026-11-01). Reads JSONL records on stdin; a line {"__task": "<id>"} starts a new source member.
// Writes one TSV line per record (never text, titles or names):
//   R <tab> key <tab> text_sha256 <tab> declared_sha256 <tab> chars <tab> chunks <tab> tokens <tab> state <tab> servable
//     <tab> retrieval_excluded <tab> replaces_text <tab> licence <tab> page_split <tab> extraction <tab> feature <tab> doc_type
//     <tab> personal_fields (comma-separated names of non-empty personal-data fields; names only)
// and "T <tab> task" before each member, "E <tab> reason" for an unreadable line.
// state: text (non-empty text), ocr_needed (no text, but a source file or URL is declared), no_text (neither).
// Chunks and tokens come from the shared whole-document chunker (chunkUnit with CHUNK defaults; estimateTokens per span).
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { chunkUnit, estimateTokens } from '../../../supabase/functions/_shared/chunking.ts';

const clean = (v) => (v === undefined || v === null ? '' : String(v).replace(/[\t\r\n]/g, ' ').slice(0, 200));
const flag = (v) => (v === true ? 'T' : v === false ? 'F' : '');
// Fields that hold personal data when present and non-empty: only their names are reported, never their values.
const PERSONAL_FIELDS = ['bidder_address_in_source', 'candidate', 'address', 'phone', 'mobile', 'email', 'pan', 'aadhaar',
  'dob', 'date_of_birth', 'father_name', 'spouse_name'];
const out = [];
const flush = () => { if (out.length) { process.stdout.write(out.join('')); out.length = 0; } };

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let r;
  try {
    r = JSON.parse(line);
  } catch (e) {
    out.push(`E\tunparsable line\n`);
    continue;
  }
  if (r && typeof r === 'object' && r.__task !== undefined) {
    out.push(`T\t${clean(r.__task)}\n`);
    flush();
    continue;
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    out.push(`E\tnot an object\n`);
    continue;
  }
  const key = r.source_key ?? r.key ?? r.row_key ?? r.id ?? r.doc_id ?? '';
  const text = typeof r.text === 'string' ? r.text : '';
  let chunks = 0, tokens = 0, sha = '';
  if (text) {
    const spans = chunkUnit({ unitKey: 'document', text, sourceKind: 'document' });
    chunks = spans.length;
    for (const s of spans) tokens += estimateTokens(s.content);
    sha = createHash('sha256').update(text, 'utf8').digest('hex');
  }
  const source = r.file_url ?? r.url ?? r.download_url ?? r.pdf_url ?? r.source_path ?? r.file_name ?? r.tender_document_url ?? '';
  const state = text ? 'text' : source ? 'ocr_needed' : 'no_text';
  out.push([
    'R', clean(key), sha, clean(r.content_sha256 ?? r.text_sha256 ?? r.sha256), text.length, chunks, tokens, state,
    flag(r.servable), flag(r.retrieval_excluded), flag(r.replaces_text), clean(r.licence_class ?? r.licence),
    clean(r.page_split), clean(r.extraction ?? r.text_engine ?? r.engine), clean(r.desk_feature ?? r.feature),
    clean(r.doc_type ?? r.kind),
    PERSONAL_FIELDS.filter((f) => r[f] !== undefined && r[f] !== null && r[f] !== '' && !(Array.isArray(r[f]) && !r[f].length)).join(','),
  ].join('\t') + '\n');
  if (out.length >= 2000) flush();
}
flush();
