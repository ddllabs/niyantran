/**
 * D14 — Central / state tender boards: hide notices whose deadline has passed.
 * Rows without a deadline (news wires, exhaustive backup packs) stay visible —
 * missing deadline is not the same as expired.
 */
function parseDeadline(raw) {
  const s = String(raw || '').replace(/-/g, ' ');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isOpenTender(row, now = Date.now()) {
  const d = parseDeadline(row?.deadline);
  if (!d) return true; // no deadline → keep (backup / coverage rows)
  return d.getTime() > now;
}

/**
 * The status a tender row should show (audit 2026-10-15, cause 7): a stored
 * "Open" (or no status) whose deadline has passed is Closed. Any other stored
 * status (Cancelled, Awarded…) and a row with no readable deadline keep theirs.
 */
export function tenderStatus(row, now = Date.now()) {
  const stored = String(row?.status ?? '').trim();
  if (isOpenTender(row, now)) return stored;
  return !stored || /^open$/i.test(stored) ? 'Closed' : stored;
}

function withDerivedStatus(rows, now) {
  let changed = false;
  const out = rows.map((r) => {
    if (!r || typeof r !== 'object' || r.status === 'source_status') return r;
    const status = tenderStatus(r, now);
    if (status === String(r.status ?? '').trim()) return r;
    changed = true;
    return { ...r, status };
  });
  return changed ? out : rows;
}

export function applyOpenTenderFilterToFeed(feed, now = Date.now()) {
  const feature = String(feed?.feature || '');
  if (!/central tender|tender aggregator/i.test(feature)) return feed;
  const rows = Array.isArray(feed?.rows) ? feed.rows : [];
  if (!rows.length) return feed;
  // Exhaustive backup is the last-resort pack — do not empty the board, but do not call an expired notice Open.
  if (feed?.source?.kind === 'backup-pack' || feed?.meta?.backup || feed?.meta?.exhaustive) {
    const shown = withDerivedStatus(rows, now);
    return shown === rows ? feed : { ...feed, rows: shown };
  }
  const open = rows.filter((r) => isOpenTender(r, now));
  const expired = rows.length - open.length;
  if (!expired) return feed;
  return {
    ...feed,
    rows: open,
    meta: {
      ...(feed.meta || {}),
      tenderExpiredHidden: expired,
      boardNote:
        open.length === 0
          ? `All ${expired} stored tenders have passed their deadline. The board stays empty rather than listing expired notices.`
          : `Hidden ${expired} expired tender${expired === 1 ? '' : 's'}; showing ${open.length} still open.`,
    },
    source: {
      ...(feed.source || {}),
      note:
        open.length === 0
          ? 'No open tenders in the archive (deadlines passed). Not a live eProcure feed.'
          : feed.source?.note,
    },
  };
}
