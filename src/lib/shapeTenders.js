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

export function applyOpenTenderFilterToFeed(feed) {
  const feature = String(feed?.feature || '');
  if (!/central tender|tender aggregator/i.test(feature)) return feed;
  // Exhaustive backup is the last-resort pack — do not empty the board.
  if (feed?.source?.kind === 'backup-pack' || feed?.meta?.backup || feed?.meta?.exhaustive) {
    return feed;
  }
  const rows = Array.isArray(feed?.rows) ? feed.rows : [];
  if (!rows.length) return feed;
  const open = rows.filter((r) => isOpenTender(r));
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
