/**
 * Shared readiness model for desk modules.
 * LIVE | CACHED | ARCHIVED | CURATED | OFFLINE | PLANNED | ERROR
 */

import { isStoreAnswer } from './plainSourceNote.js';

export const DATA_STATE = {
  // Feedback: never show Archived / Archive next to desk headers.
  archived: { id: 'archived', label: '', tone: 'muted', hideBadge: true },
  curated: { id: 'curated', label: '', tone: 'muted', hideBadge: true },
  cached: { id: 'cached', label: '', tone: 'warn', hideBadge: true },
  offline: { id: 'offline', label: 'OFFLINE', tone: 'warn' },
  planned: { id: 'planned', label: 'PLANNED', tone: 'muted' },
  error: { id: 'error', label: 'ERROR', tone: 'bad' },
  loading: { id: 'loading', label: 'LOADING', tone: 'muted' },
  live: { id: 'live', label: 'LIVE', tone: 'ok' },
  // F169 C4: items kept by the scheduled refresh and served from the feed store. Fresh data, but not
  // fetched for this request, so no LIVE badge; the header says how long ago ("updated 5 min ago").
  served: { id: 'served', label: '', tone: 'ok', hideBadge: true },
};

const PLANNED_RE =
  /not yet shipped|not scheduled|extraction not scheduled|adapter is not|until feeds? exist|planned|coming soon|no public api|credential or licence|terms review|connector parked/i;

const CURATED_RE = /curated|editorial|reference dataset|managed archive|local pack|dossier pack|html pack/i;

const OFFLINE_RE = /unavailable|unreachable|http\s*502|http\s*503|timed?\s*out|offline|failed/i;

function statusRow(feed) {
  const row = feed?.rows?.[0];
  return row?.status === 'source_status' ? row : null;
}

function noteBlob(feed) {
  const sr = statusRow(feed);
  return [
    feed?.source?.note,
    feed?.meta?.note,
    feed?.meta?.status,
    sr?.title,
    sr?.detail,
    sr?.fail_reason,
    feed?.error,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Resolve the single honest data state for a feature-feed envelope.
 * Never returns LIVE when fallback/archive is showing.
 */
export function resolveDataState(feed, { loading = false, error = '' } = {}) {
  if (loading) return { ...DATA_STATE.loading, detail: 'Fetching…' };
  if (error && !feed) {
    return { ...DATA_STATE.error, detail: String(error) };
  }

  const sr = statusRow(feed);
  const blob = noteBlob(feed);
  const kind = String(feed?.source?.kind || '');
  const adapter = String(feed?.source?.adapter || '');
  const rows = (feed?.rows || []).filter((r) => r?.status !== 'source_status');
  // F156: a paged answer holds one page (empty when nothing matches a search); `totalAll` is the
  // register's size.
  const count = feed?.paged ? Math.max(0, Number(feed.totalAll) || 0) : rows.length;

  if (sr || count === 0) {
    if (PLANNED_RE.test(blob) || /scrape|licensed|credential/i.test(adapter)) {
      return {
        ...DATA_STATE.planned,
        detail: sr?.detail || sr?.title || 'Adapter or dataset is not yet shipped for this module.',
        host: sr?.host || '',
        sourceNote: feed?.source?.note || '',
      };
    }
    if (OFFLINE_RE.test(blob) || error) {
      return {
        ...DATA_STATE.offline,
        detail: sr?.detail || sr?.title || String(error) || 'Source is temporarily unavailable.',
        host: sr?.host || '',
        sourceNote: feed?.source?.note || '',
      };
    }
    return {
      ...DATA_STATE.planned,
      detail: sr?.detail || sr?.title || 'No live rows and no archive on this host.',
      host: sr?.host || '',
      sourceNote: feed?.source?.note || '',
    };
  }

  // F169 C4: not live (no badge), not an archive or stored copy (no banner).
  if (isStoreAnswer(feed)) {
    return {
      ...DATA_STATE.served,
      // Review of 1345bfd (finding 1): a copy past its freshness limit, kept because the live path
      // brought nothing better, is still served but warns.
      ...(feed.stale === true ? { tone: 'warn', stale: true } : {}),
      detail: feed?.source?.note || 'Updated by the scheduled refresh.',
      coverage: coverageText(feed, count),
      lastSync: lastSyncText(feed),
    };
  }

  if (feed?.meta?.curated || CURATED_RE.test(blob) || /curated/i.test(kind)) {
    return {
      ...DATA_STATE.curated,
      detail: feed?.source?.note || 'Editorial / reference dataset.',
      coverage: coverageText(feed, count),
      lastSync: lastSyncText(feed),
    };
  }

  if (feed?.fallback) {
    const ageH = Number(feed?.ageH ?? feed?.meta?.ageH);
    const recent = Number.isFinite(ageH) && ageH <= 24;
    const isBackup = /backup-pack/i.test(kind) || /exhaustive shipped backup/i.test(blob);
    const state = isBackup ? DATA_STATE.archived : recent ? DATA_STATE.cached : DATA_STATE.archived;
    // F159: a backup pack's own note describes the pack file; the reader is told what they see.
    return {
      ...state,
      detail: isBackup
        ? 'Showing the latest stored records.'
        : feed?.source?.note ||
          (recent
            ? 'The live source isn\u2019t responding. Showing the latest stored records.'
            : 'Dated historical snapshot. Not a live feed.'),
      sourceNote: feed?.source?.note || '',
      coverage: coverageText(feed, count),
      lastSync: lastSyncText(feed),
      fallback: true,
    };
  }

  // Module audit 2026-10-15 (C1): LIVE only for an answer that is positively live, never by default
  // and never because a note contains the word ("no live price feed", "not the live table").
  if (isLiveAnswer(feed)) {
    return {
      ...DATA_STATE.live,
      detail: feed?.source?.note || 'Live request returned rows.',
      coverage: coverageText(feed, count),
      lastSync: lastSyncText(feed),
    };
  }

  // Registers, packs, dossiers, embedded and internal answers: stored records with no badge; the
  // header says how current they are ("stored copy · as of …").
  return {
    ...DATA_STATE.archived,
    detail: feed?.source?.note || 'Stored records.',
    coverage: coverageText(feed, count),
    lastSync: lastSyncText(feed),
  };
}

// Adapters that fetch from the source for the request being answered.
const LIVE_ADAPTERS = new Set(['api', 'live', 'news-search', 'scrape']);
// Kinds that name stored records whatever the adapter.
const STORED_KIND_RE = /pack|register/i;

/**
 * An answer fetched live for this request: a live adapter, served live (or built in the browser from a
 * live call, with no `served`), not a fallback, and not a pack or register. Store answers are decided
 * before this (`served`, "updated N min ago").
 */
function isLiveAnswer(feed) {
  const served = feed?.served;
  if (served !== undefined && served !== 'live') return false;
  if (feed?.fallback) return false;
  if (STORED_KIND_RE.test(String(feed?.source?.kind || ''))) return false;
  return LIVE_ADAPTERS.has(String(feed?.source?.adapter || ''));
}

function coverageText(feed, n) {
  if (feed?.coverage?.label) return feed.coverage.label;
  if (feed?.coverage?.through) return `${n} records · through ${feed.coverage.through}`;
  if (feed?.coverage?.exhaustive) return `${n} records · exhaustive`;
  if (n) return `${n} records`;
  return '';
}

function lastSyncText(feed) {
  const raw =
    feed?.updated ||
    feed?.meta?.updated ||
    feed?.meta?.lastSync ||
    feed?.coverage?.through ||
    feed?.source?.verifiedAt ||
    '';
  return raw ? String(raw) : '';
}

export function isTerminalState(state) {
  return state?.id === 'planned' || state?.id === 'offline' || state?.id === 'error';
}
