// Corpus inventory, pass 2: per-record facts with the repository chunker. Read-only; no network.
// Status: Living (2026-11-01). Reads JSONL records on stdin; a line {"__task": "<id>"} starts a new source member.
// Writes one TSV line per record (never text, titles or names):
//   R <tab> key <tab> text_sha256 <tab> declared_sha256 <tab> chars <tab> chunks <tab> tokens <tab> state <tab> servable
//     <tab> retrieval_excluded <tab> replaces_text <tab> licence <tab> page_split <tab> extraction <tab> feature <tab> doc_type
//     <tab> personal_fields (comma-separated names of non-empty personal-data fields; names only)
//     <tab> L when the record parsed only after escaping raw control characters, else empty
// and "T <tab> task" before each member, "E <tab> reason <tab> line" for an unreadable line (1-based line number within the member;
// never its content).
// state: text (non-empty text), ocr_needed (no text, but a source file or URL is declared), no_text (neither).
// Chunks and tokens come from the shared whole-document chunker (chunkUnit with CHUNK defaults; estimateTokens per span).
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { chunkUnit, estimateTokens } from '../../../supabase/functions/_shared/chunking.ts';

const clean = (v) => (v === undefined || v === null ? '' : String(v).replace(/[\t\r\n]/g, ' ').slice(0, 200));
const flag = (v) => (v === true ? 'T' : v === false ? 'F' : '');
// Fields that hold personal data when present and non-empty: only their names are reported, never their values.
// present(): '' when absent, false, null, empty string/array/object; '=true' for boolean true; '' suffix for a value.
const present = (v) => (v === true ? '=true' : v === undefined || v === null || v === false || v === '' ? null
  : Array.isArray(v) ? (v.length ? '' : null) : typeof v === 'object' ? (Object.keys(v).length ? '' : null) : '');
const PERSONAL_FIELDS = ['bidder_address_in_source', 'candidate', 'address', 'phone', 'mobile', 'email', 'pan', 'aadhaar',
  'dob', 'date_of_birth', 'father_name', 'spouse_name'];
const out = [];
let lineNo = 0;
const flush = () => { if (out.length) { process.stdout.write(out.join('')); out.length = 0; } };

// Lines are split on "\n" only (a trailing "\r" is dropped), so line numbers match the member's real lines. node:readline
// would also split on a bare "\r", which cuts records whose strings hold raw carriage returns into fragments.
// A line that fails strict JSON.parse is retried with raw control characters escaped (as Python's json.loads(strict=False)
// accepts them); such records are counted and flagged "L" in the last column. Lines that still fail are reported as E.
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\r]/g;
const esc = (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
async function* lines(stream) {
  const dec = new StringDecoder('utf8');
  let buf = '';
  for await (const chunk of stream) {
    buf += dec.write(chunk);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { yield buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); }
  }
  buf += dec.end();
  if (buf) yield buf.replace(/\r$/, '');
}
for await (const line of lines(process.stdin)) {
  lineNo += 1;
  if (!line.trim()) continue;
  let r, lenient = '';
  try {
    r = JSON.parse(line);
  } catch (e) {
    try {
      r = JSON.parse(line.replace(CTRL, esc));
      lenient = 'L';
    } catch (e2) {
      out.push(`E\tunparsable line\t${lineNo}\n`);
      continue;
    }
  }
  if (r && typeof r === 'object' && r.__task !== undefined) {
    out.push(`T\t${clean(r.__task)}\n`);
    lineNo = 0;
    flush();
    continue;
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    out.push(`E\tnot an object\t${lineNo}\n`);
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
    PERSONAL_FIELDS.map((f) => present(r[f])).map((p, i) => (p !== null ? PERSONAL_FIELDS[i] + p : '')).filter(Boolean).join(','),
    lenient,
  ].join('\t') + '\n');
  if (out.length >= 2000) flush();
}
flush();
