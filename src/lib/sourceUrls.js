/**
 * Shared URL ranking for AI grounding / source extract.
 * Pure helpers — safe for browser and Node (Vite + Vercel).
 * Applies to every desk row, not only Bill Passage.
 */

const URL_KEYS = [
  'pdf_url',
  'document_url',
  'doc_url',
  'file_url',
  'attachment_url',
  'detail_url',
  'html_url',
  'source_url',
  'url',
  'link',
  'href',
];

export function isHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u.trim());
}

export function isGoogleNewsUrl(u) {
  return /news\.google\.com/i.test(String(u || ''));
}

/**
 * Registry / listing hubs that are provenance only — not the record body.
 * Fetching these just returns chrome, so the model appears to "only read a URL".
 */
export function isHubListingUrl(u) {
  const s = String(u || '').trim();
  if (!s) return true;
  if (isGoogleNewsUrl(s)) return true;
  let url;
  try {
    url = new URL(s);
  } catch {
    return true;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const path = (url.pathname || '/').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const q = url.search || '';

  if (parts.length === 0) return true;

  if (/sansad\.(in|gov\.in)$/i.test(host) && /\/(?:rs|ls)?\/?legislation$/i.test(path) && !/\.pdf$/i.test(path)) {
    return true;
  }
  if (/sci\.gov\.in$/i.test(host) && /\/view-pdf$/i.test(path)) return true;
  if (/rbi\.org\.in$/i.test(host) && /BS_PressReleaseDisplay\.aspx$/i.test(path) && !q) return true;
  if (/pib\.gov\.in$/i.test(host) && /PressReleasePage\.aspx$/i.test(path) && !/[?&](PRID|prid|id)=/i.test(q)) return true;
  if (
    /^(nseindia\.com|prsindia\.org|indiacode\.nic\.in|egazette\.gov\.in|powermin\.gov\.in|commerce\.gov\.in|understandingwar\.org|acleddata\.com)$/i.test(
      host,
    ) &&
    parts.length <= 1
  ) {
    return true;
  }
  if (/api\.fda\.gov$/i.test(host) && /enforcement\.json$/i.test(path)) return true;

  return false;
}

export function sourceKindHint(u) {
  const path = String(u || '').split('?')[0].toLowerCase();
  if (/\.pdf$/i.test(path) || (/getfile/i.test(path) && /pdf/i.test(String(u)))) return 'pdf';
  if (/\.xlsx?$/i.test(path)) return 'sheet';
  if (/\.csv$/i.test(path)) return 'csv';
  if (/\.docx?$/i.test(path)) return 'doc';
  if (/\/annex\/|\/questions\/|gazette|circular|notification|importalert_/i.test(path)) return 'page';
  return 'page';
}

/** True when the URL is worth fetching for body text (any desk). */
export function isExtractableSourceUrl(u) {
  if (!isHttpUrl(u) || isHubListingUrl(u)) return false;
  const kind = sourceKindHint(u);
  if (kind === 'pdf' || kind === 'sheet' || kind === 'csv' || kind === 'doc') return true;
  const raw = String(u);
  const path = raw.split('?')[0];
  if (
    /getfile|\.pdf(\?|$)|\/annex\/|\/billtext|\/bills\/|\/uploads\/|\/rdocs\/|tranpdfs|importalert_|PressReleasePage\.aspx\?/i.test(
      raw,
    )
  ) {
    return true;
  }
  if (/circular|master.?direction|notification|consultation|methodology/i.test(path)) return true;
  try {
    const url = new URL(u);
    const parts = (url.pathname || '/').split('/').filter(Boolean);
    if (/[?&](id|Id|ID|prid|PRID|releaseid|Relid)=/i.test(url.search || '')) return true;
    if (parts.length >= 3) return true;
    if (parts.length >= 2 && !/^(en|scripts|api|cms_ia|ls|rs)$/i.test(parts[0])) return true;
  } catch {
    return false;
  }
  return false;
}

function scoreUrl(u) {
  const kind = sourceKindHint(u);
  if (kind === 'pdf') return 0;
  if (kind === 'sheet' || kind === 'csv' || kind === 'doc') return 1;
  if (/sansad\.|prsindia|indiacode|egazette|rbi\.org|rbidocs|sebi\.gov|ibbi\.gov|dgft|mha\.gov/i.test(u) && isExtractableSourceUrl(u)) {
    return 2;
  }
  if (isExtractableSourceUrl(u)) return 3;
  return 9;
}

/** Collect + rank URLs from any desk row. Hubs are excluded from extractable list. */
export function collectRowUrls(row, { pdf, source } = {}) {
  const all = [];
  const push = (u) => {
    const s = String(u || '').trim();
    if (!isHttpUrl(s) || isGoogleNewsUrl(s)) return;
    if (!all.includes(s)) all.push(s);
  };
  push(pdf);
  push(source);
  if (row && typeof row === 'object') {
    for (const k of URL_KEYS) push(row[k]);
    if (typeof row.sources_json === 'string') {
      try {
        const arr = JSON.parse(row.sources_json);
        for (const s of arr || []) {
          if (Array.isArray(s)) push(s[1]);
          else if (s && typeof s === 'object') push(s.url || s.href || s.link);
          else push(s);
        }
      } catch {
        /* ignore */
      }
    }
    for (let i = 1; i <= 8; i += 1) push(row[`source_${i}_url`]);
    for (const [k, v] of Object.entries(row)) {
      if (URL_KEYS.includes(k) || /^source_\d+_url$/.test(k)) continue;
      if (typeof v === 'string' && isHttpUrl(v)) push(v);
    }
  }

  const extractable = all.filter(isExtractableSourceUrl).sort((a, b) => scoreUrl(a) - scoreUrl(b));
  const hubs = all.filter((u) => isHubListingUrl(u) || !isExtractableSourceUrl(u));
  return {
    all,
    extractable,
    hubs,
    toFetch: extractable.slice(0, 3),
  };
}

/** Human-readable record from row columns — works for every desk schema. */
export function rowRecordText(row, { title = '', max = 6_000 } = {}) {
  if (!row || typeof row !== 'object') return '';
  const skip = new Set([
    // Identifiers never go in the record the model reads. A labelled `id:` line
    // is indistinguishable from a citable token, and the model imitates it into
    // the answer instead of citing the issued ref: handle - which is exactly
    // what _shared/handles.ts warns about. Mirrored in _shared/deskRows.ts.
    'id',
    'record_id',
    'row_key',
    'uuid',
    '__alId',
    '__gaId',
    '__saId',
    'members_json',
    'agenda_json',
    'sources_json',
    'attached_sources',
    'attached_documents',
    'provenance_hubs',
    'record_text',
    'document_status',
    'related_records',
    'timeline',
  ]);
  const lines = [];
  const head =
    title ||
    row.bill_name ||
    row.policy_name ||
    row.conflict_name ||
    row.title ||
    row.subject ||
    row.name ||
    row.commodity ||
    row.theatre ||
    row.programme ||
    row.leader ||
    row.facility ||
    '';
  if (head) lines.push(`Record: ${head}`);
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k) || k.startsWith('_')) continue;
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    const s = String(v).trim();
    if (!s) continue;
    if (isHttpUrl(s) && isHubListingUrl(s)) {
      lines.push(`${k}: ${s} (registry hub — provenance only, not document body)`);
      continue;
    }
    lines.push(`${k}: ${s.slice(0, 800)}`);
    if (lines.join('\n').length > max) break;
  }
  return lines.join('\n').slice(0, max);
}

/** Stable id so we do not double-pin the same desk row. */
export function rowPinKey(row) {
  if (!row || typeof row !== 'object') return '';
  return String(
    row.id ||
      row.record_id ||
      row.bill_number ||
      row.source_url ||
      row.bill_name ||
      row.title ||
      row.name ||
      row.subject ||
      '',
  )
    .trim()
    .toLowerCase()
    .slice(0, 160);
}
