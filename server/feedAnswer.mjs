/**
 * F169: what counts as a live answer, shared by the store writer (server/feedStore.mjs, which keeps
 * only live answers) and the page server (server/feedServe.mjs, where a live answer may take the
 * place of an old stored copy). It imports no loaders, so the page server can use it without loading
 * them (feedStore.mjs imports featureFeed.mjs).
 */
import { safeText } from './supabaseRpc.mjs';

/**
 * The adapters a scheduled module's live answer uses (server/featureFeed.mjs and nationalFeed.mjs;
 * the 2026-10-15 local run's 64 live answers used only these). Anything else is refused by
 * default: `embedded` (bundled data), `bill-history` (the archive merge), `internal` (simulators),
 * `planned`, the registry's own names on the generic path, and anything new.
 */
export const LIVE_ADAPTERS = Object.freeze(new Set(['api', 'news-search', 'live']));

const isStatusRow = (r) => r && typeof r === 'object' && r.status === 'source_status';

/**
 * Whether a loader's answer is live (ok or empty) or must not be kept (failed). The envelope marks
 * a stored answer several ways (server/featureFeed.mjs): `fallback` when a live source failed and
 * stored rows stand in (or a loader answered its stale cache), `served: 'archive'` and kind
 * `backup-pack` for the archive and backup passes, an adapter outside LIVE_ADAPTERS, and a
 * `source_status` row when nothing could be shown. refreshDue adds one more test the envelope
 * cannot make: an answer for which no request reached a source is not live.
 */
export function classifyAnswer(body) {
  if (!body || typeof body !== 'object') return { status: 'failed', reason: 'the loader gave no answer' };
  const source = body.source || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const statusReason = rows.find(isStatusRow)?.fail_reason;
  const detail = safeText(statusReason || source.diagnostic || source.note || body.error || '', 200);
  const failed = (why) => ({ status: 'failed', reason: safeText(detail ? `${why}: ${detail}` : why) });
  if (body.ok === false) return failed('the loader could not serve this module');
  if (source.adapter === 'planned') return failed('a planned module has no live source');
  if (body.served === 'archive') return failed('the answer came from the stored archive');
  if (source.kind === 'backup-pack') return failed('the answer came from the backup pack');
  if (body.fallback) return failed('a live source failed and stored rows stood in');
  if (source.adapter === 'embedded') return failed('the answer is a stored copy, not a live one');
  if (!LIVE_ADAPTERS.has(source.adapter)) return failed(`adapter "${safeText(source.adapter || 'none', 40)}" is not a live source`);
  const real = rows.filter((r) => !isStatusRow(r));
  if (rows.length && !real.length) return failed('the source was offline or empty');
  if (!real.length) return { status: 'empty', reason: 'the source answered with no items' };
  return { status: 'ok', reason: '' };
}
