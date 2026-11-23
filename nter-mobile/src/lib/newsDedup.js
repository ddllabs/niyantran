/**
 * Client-side news cleanup: collapse copy-paste / syndicated headlines
 * that match after light normalisation. Does not invent verification —
 * it only labels whether a linked source is present.
 */

const NEWS_FEATURE_RE =
  /news\s*wire|newswire|morning\s*brief|hyperlocal|district\s*media|cricket\s*wire|football\s*wire|indian\s*sports\s*wire|bollywood|statements|media\s*mention|climate\s*news|carbon\s*registry\s*wire/i;

const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'for',
  'and',
  'or',
  'with',
  'from',
  'by',
  'at',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'that',
  'this',
  'it',
  'its',
  'after',
  'before',
  'over',
  'under',
  'into',
  'says',
  'said',
]);

export function isNewsWireFeature(feature) {
  return NEWS_FEATURE_RE.test(String(feature || ''));
}

export function normalizeHeadline(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&amp;/g, 'and')
    .replace(/[''`´""]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(' ')
    .trim();
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function headlineText(row) {
  return String(row?.title || row?.headline || row?.name || '').trim();
}

function outletOf(row) {
  return String(row?.outlet || row?.source || row?.source_label || hostOf(row?.source_url) || '').trim();
}

function publishedOf(row) {
  return String(row?.published || row?.pub_date || row?.date || row?.pub || row?.seendate || row?.time || '').trim();
}

function scoreRow(row) {
  let s = 0;
  if (row?.source_url) s += 4;
  if (outletOf(row)) s += 2;
  if (publishedOf(row)) s += 1;
  if (String(row?.region || row?.topic || '').trim()) s += 1;
  return s;
}

function dateRank(row) {
  const t = Date.parse(publishedOf(row));
  return Number.isFinite(t) ? t : 0;
}

function prefer(a, b) {
  const sa = scoreRow(a);
  const sb = scoreRow(b);
  if (sa !== sb) return sa > sb;
  return dateRank(a) >= dateRank(b);
}

export function headlineKey(row) {
  const n = normalizeHeadline(headlineText(row));
  if (!n) return '';
  if (n.length >= 20) return n;
  const host = hostOf(row?.source_url);
  return host ? `${n}|${host}` : n;
}

/**
 * Collapse rows that share the same cleaned headline.
 * Keeps the richest copy; records sibling outlets on the survivor.
 */
export function dedupeNewsRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const order = [];
  const map = new Map();

  for (const row of rows) {
    if (!row || row.status === 'source_status') {
      order.push({ kind: 'raw', row });
      continue;
    }
    const key = headlineKey(row);
    if (!key) {
      order.push({ kind: 'raw', row });
      continue;
    }
    const hit = map.get(key);
    if (!hit) {
      const entry = { kind: 'group', key, primary: row, siblings: [row] };
      map.set(key, entry);
      order.push(entry);
      continue;
    }
    hit.siblings.push(row);
    if (prefer(row, hit.primary)) hit.primary = row;
  }

  return order.map((item) => {
    if (item.kind === 'raw') return item.row;
    const { primary, siblings } = item;
    const outlets = [...new Set(siblings.map(outletOf).filter(Boolean))];
    const links = [...new Set(siblings.map((r) => r.source_url).filter(Boolean))];
    const dupCount = siblings.length;
    const verification = primary.verification
      ? String(primary.verification)
      : primary.source_url
        ? 'Linked source'
        : 'No link yet';

    return {
      ...primary,
      title: headlineText(primary) || primary.title,
      outlet: outletOf(primary) || outlets[0] || '',
      source: outletOf(primary) || primary.source || '',
      published: publishedOf(primary),
      date: publishedOf(primary) || primary.date || '',
      verification,
      related_count: Math.max(0, dupCount - 1),
      related_outlets: outlets.filter((o) => o !== outletOf(primary)).join(', '),
      related_links: links.filter((u) => u !== primary.source_url).slice(0, 8),
      dup_group_size: dupCount,
    };
  });
}

export function applyNewsDedupToFeed(feed) {
  if (!feed || !isNewsWireFeature(feed.feature)) return feed;
  const before = (feed.rows || []).filter((r) => r?.status !== 'source_status').length;
  const rows = dedupeNewsRows(feed.rows || []).map((r) => {
    if (!r || r.status === 'source_status') return r;
    // Climate Wire: no verification / data-check columns.
    if (/^climate newswire$/i.test(String(feed.feature || ''))) {
      const { verification, related_count, related_outlets, related_links, ...rest } = r;
      return rest;
    }
    return r;
  });
  const after = rows.filter((r) => r?.status !== 'source_status').length;
  const removed = Math.max(0, before - after);
  const noteBits = [feed.meta?.note, feed.source?.note].filter(Boolean);
  if (removed > 0) {
    noteBits.push(
      `Removed ${removed} repeat headline${removed === 1 ? '' : 's'} that looked like the same story from more than one outlet.`,
    );
  }
  return {
    ...feed,
    rows,
    meta: {
      ...(feed.meta || {}),
      newsDedupRemoved: removed,
      newsDedupBefore: before,
      note: noteBits.filter(Boolean).join(' '),
    },
  };
}
