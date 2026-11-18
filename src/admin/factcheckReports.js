// F362: the administrator's list of reported fact-check claims, and the three actions on it
// (docs/specs/2026-11-18-live-tv-admin-reports.md). The reads and writes go through the signed-in client to four database
// functions that each check for a platform administrator themselves; nothing here is a gate.
//
//   factcheck_reports_admin(p_offset, p_limit)   the open reports, one row per claim
//   factcheck_claim_hide(p_claim)                hide the claim and handle its reports
//   factcheck_report_dismiss(p_claim)            handle the claim's reports, leave the claim
//   factcheck_video_remove(p_video_id)           delete the video's stored pieces and stop sharing it (cannot be undone)
//
// The screen never shows server text: every failure becomes one of two fixed sentences. The reporters' texts are user-written
// and the claim text comes from a video, so they are data: this module hands them on as plain strings and the page renders
// them as text.

export const LOAD_ERROR = 'The reports could not be loaded.';
export const ACTION_ERROR = 'That did not work. Nothing was changed, or it may already have been done. Try again.';
export const MAX_REASONS = 10;

/** Action kind to the database function and the argument it takes. */
export const REPORT_ACTIONS = {
  hide: { fn: 'factcheck_claim_hide', arg: 'p_claim', from: 'claimId' },
  dismiss: { fn: 'factcheck_report_dismiss', arg: 'p_claim', from: 'claimId' },
  remove: { fn: 'factcheck_video_remove', arg: 'p_video_id', from: 'videoId' },
};

const isText = (v) => typeof v === 'string';

/** The URL as the browser reads it when its scheme is http or https; otherwise null (javascript:, data:, file:, relative...). */
export function safeHttpUrl(value) {
  if (!isText(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function shapeSources(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const href = safeHttpUrl(s.url);
    const title = (isText(s.title) && s.title.trim()) || (isText(s.url) ? s.url : '');
    if (title) out.push({ title, href });
  }
  return out;
}

/**
 * The rows the server sent, as the page uses them. Only the agreed fields are copied, so nothing else the server sent (an id
 * of a person, say) can reach the screen. A row without a claim id is skipped.
 */
export function shapeReportRows(data) {
  if (!Array.isArray(data)) return [];
  const rows = [];
  for (const r of data) {
    if (!r || typeof r !== 'object' || !isText(r.claim_id) || !r.claim_id) continue;
    rows.push({
      claimId: r.claim_id,
      videoId: isText(r.video_id) ? r.video_id : '',
      channelId: isText(r.channel_id) ? r.channel_id : '',
      videoKind: isText(r.video_kind) ? r.video_kind : '',
      claim: isText(r.claim_en) ? r.claim_en : '',
      status: isText(r.status) ? r.status : '',
      verdict: isText(r.verdict) ? r.verdict : null,
      verdictReason: isText(r.verdict_reason) ? r.verdict_reason : '',
      sources: shapeSources(r.sources),
      shared: r.shared === true,
      hiddenAt: isText(r.hidden_at) ? r.hidden_at : null,
      reportCount: Number.isFinite(r.report_count) ? r.report_count : 0,
      newestReportAt: isText(r.newest_report_at) ? r.newest_report_at : null,
      reasons: (Array.isArray(r.report_reasons) ? r.report_reasons : []).filter((t) => isText(t) && t !== '').slice(0, MAX_REASONS),
    });
  }
  return rows;
}

/** One page of open reports. Resolves to { status: 'ready', total, rows } or { status: 'error' }; never throws. */
export async function loadReports(client, { offset, limit }) {
  try {
    const { data, error } = await client.rpc('factcheck_reports_admin', { p_offset: offset, p_limit: limit });
    if (error || !data || typeof data !== 'object' || !Array.isArray(data.rows) || !Number.isFinite(data.total)) return { status: 'error' };
    return { status: 'ready', total: data.total, rows: shapeReportRows(data.rows) };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Runs one of the three actions. `target` is { claimId, videoId }. Resolves to { ok: true } only when the database answered
 * `ok: true`; a refusal, a thrown error, `ok: false` (not_found) and anything else are all { ok: false }. Never throws.
 */
export async function runReportAction(client, kind, target) {
  const action = Object.hasOwn(REPORT_ACTIONS, kind) ? REPORT_ACTIONS[kind] : null;
  const value = action ? target?.[action.from] : null;
  if (!action || !isText(value) || !value) return { ok: false };
  try {
    const { data, error } = await client.rpc(action.fn, { [action.arg]: value });
    return !error && data?.ok === true ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * The state of the screen, without React, so every step can be tested. State:
 *   status      'loading' | 'ready' | 'error'
 *   rows, total, offset, pageSize
 *   pending     null, or { claimId, kind }: the confirmation that is open (one at a time)
 *   busy        an action is running
 *   actionError null, or { claimId, text }
 * An action runs only from confirm(), and only for the open confirmation. After a good action the list is read again.
 */
export function createReportsController(client, { pageSize = 25 } = {}) {
  let state = { status: 'loading', rows: [], total: 0, offset: 0, pageSize, pending: null, busy: false, actionError: null };
  let ticket = 0;
  const listeners = new Set();
  const set = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn(state));
  };

  async function load(offset = state.offset) {
    const mine = ++ticket;
    set({ status: 'loading', offset });
    const result = await loadReports(client, { offset, limit: pageSize });
    if (mine !== ticket) return;
    if (result.status !== 'ready') {
      set({ status: 'error' });
      return;
    }
    if (result.rows.length === 0 && result.total > 0 && offset > 0) {
      // The last claim of the last page was dealt with: step back to the new last page.
      await load(Math.max(0, Math.floor((result.total - 1) / pageSize) * pageSize));
      return;
    }
    set({ status: 'ready', rows: result.rows, total: result.total });
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    load: () => load(state.offset),
    goTo(offset) {
      // A question belongs to the page it was asked on.
      set({ pending: null, actionError: null });
      return load(Math.max(0, offset));
    },
    ask(claimId, kind) {
      if (state.busy) return;
      const row = state.rows.find((r) => r.claimId === claimId);
      if (!row || !Object.hasOwn(REPORT_ACTIONS, kind) || (kind === 'hide' && row.hiddenAt)) return;
      set({ pending: { claimId, kind }, actionError: null });
    },
    cancel() {
      if (!state.busy) set({ pending: null });
    },
    async confirm() {
      const { pending } = state;
      if (!pending || state.busy) return;
      const row = state.rows.find((r) => r.claimId === pending.claimId);
      set({ busy: true });
      const result = row ? await runReportAction(client, pending.kind, row) : { ok: false };
      if (!result.ok) {
        // The list is read again, because the claim may be gone or changed; the error stays with its claim if it is still listed.
        set({ busy: false, pending: null, actionError: { claimId: pending.claimId, text: ACTION_ERROR } });
        await load(state.offset);
        return;
      }
      set({ busy: false, pending: null, actionError: null });
      await load(state.offset);
    },
  };
}
