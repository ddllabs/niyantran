/**
 * "Open in desk" for a `row` citation (desk-row-grounding spec §G).
 *
 * A cited row is a snapshot; the desk holds the live feed. openInDesk routes
 * the shell to the row's module through the hash (the shell listens for
 * popstate) and leaves a pending request; once the desk feed has loaded, the
 * shell calls takePendingDeskRow, which finds the row by its desk key
 * (deskRowKey — the same key the loader stored) and selects it. A feed that
 * no longer contains the key yields null and the viewer keeps the snapshot
 * with its captured-on date.
 */
import { resolveDeskRoute, writeDeskHash } from '../lib/deskRoute.js';
import { deskRowKey } from '../lib/deskRows.js';

let pending = null;

/** The outstanding request, for tests and diagnostics. */
export function pendingDeskRow() {
  return pending;
}

/** Route the shell to the citation's module and remember which row to select. */
export function openInDesk(citation) {
  if (!citation || citation.kind !== 'row') return null;
  const r = resolveDeskRoute(citation.tier, citation.feature);
  pending = { tab: r.tab, feature: r.feature, row_key: String(citation.row_key || '') };
  if (typeof window !== 'undefined') {
    writeDeskHash(r.tab, r.feature);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  return pending;
}

/**
 * Called by the shell when a feed lands. Returns the feed row to select and
 * clears the request; returns null (and clears) when the loaded module has
 * no such row; leaves the request pending while another desk is loading.
 */
export function takePendingDeskRow(feed, tab) {
  if (!pending || !feed) return null;
  if (tab !== pending.tab) return null;
  const feature = String(feed.feature || '');
  if (feature !== pending.feature) return null;
  const key = pending.row_key;
  pending = null;
  const rows = Array.isArray(feed.rows) ? feed.rows : [];
  return rows.find((r) => r && typeof r === 'object' && r.status !== 'source_status' && deskRowKey(r) === key) || null;
}
