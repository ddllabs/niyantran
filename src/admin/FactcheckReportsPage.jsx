// F362: "Fact-check reports". The open reports on shared Live TV fact-checks, one card per claim, with the three things an
// administrator can do about it. Every action asks a second question first. The view is a plain function of the controller's
// state (factcheckReports.js); this file wires it to the signed-in client. The database functions check for an
// administrator themselves, so a refusal shows the same fixed error as any other failure.
//
// Text from users (the reasons) and from videos (the claim) is always rendered as text, never as markup. A source becomes a
// link only when its address is http or https.
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { LOAD_ERROR, createReportsController } from './factcheckReports.js';

const PAGE_SIZE = 25;

const VERDICTS = {
  supported: 'Supported', contradicted: 'Contradicted', partly_true: 'Partly true', no_evidence: 'No evidence', opinion: 'Opinion',
};
const STATUSES = { pending: 'Pending', checked: 'Checked', needs_context: 'Needs context', not_checkable: 'Not checkable', error: 'Check failed' };

/** "2026-11-18 10:05 UTC": the same on every reader's clock. */
export function formatReportTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
}

function confirmation(kind, row) {
  if (kind === 'hide') {
    return {
      question: "Hide this claim? It disappears from every other user's view and its open reports are marked handled. This screen cannot undo it.",
      yes: 'Yes, hide claim',
    };
  }
  if (kind === 'dismiss') {
    return { question: 'Dismiss the open reports on this claim? The claim stays visible to others.', yes: 'Yes, dismiss reports' };
  }
  return {
    question: `Remove all shared results of video ${row.videoId}? This deletes the stored transcript of every session of this video, for every user, and stops sharing all of them. Users who paid to unlock these results lose access and their unlock credits are returned. It cannot be undone. This video's reports stay open until dismissed.`,
    yes: `Yes, remove video ${row.videoId}`,
  };
}

function renderClaim(row, { state, onAsk, onCancel, onConfirm }) {
  const { pending, busy, actionError } = state;
  const mine = pending && pending.claimId === row.claimId ? pending : null;
  const headingId = `fcr-claim-${row.claimId}`;
  const verdict = row.verdict ? VERDICTS[row.verdict] || row.verdict : STATUSES[row.status] || row.status;
  const ask = confirmation(mine?.kind, row);
  const trigger = (kind, label, danger) => (
    <button
      type="button"
      key={kind}
      className={`adm-btn tiny${danger ? ' danger' : ' ghost'}`}
      data-trigger={`${row.claimId}:${kind}`}
      aria-describedby={headingId}
      onClick={() => onAsk(row.claimId, kind)}
    >
      {label}
    </button>
  );
  return (
    <li key={row.claimId} className="adm-card adm-fcr-item">
      <h2 id={headingId} className="adm-fcr-claim">{row.claim}</h2>
      <p className="adm-fcr-meta">
        Video {row.videoId}
        {row.channelId ? ` · Channel ${row.channelId}` : ''}
        {row.videoKind ? ` · ${row.videoKind}` : ''}
      </p>
      <p className="adm-fcr-pills">
        <span className="adm-pill archive"><i />{verdict}</span>
        <span className={`adm-pill ${row.shared ? 'live' : 'local'}`}><i />{row.shared ? 'Shared' : 'Not shared'}</span>
        {row.hiddenAt ? <span className="adm-pill inactive"><i />Hidden</span> : null}
      </p>
      {row.verdictReason ? <p className="adm-fcr-reason">{row.verdictReason}</p> : null}
      {row.sources.length ? (
        <ul className="adm-fcr-sources" aria-label="Sources">
          {row.sources.map((s, i) => (
            <li key={i}>
              {s.href ? <a href={s.href} target="_blank" rel="noopener noreferrer">{s.title}</a> : <span>{s.title}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      <h3 className="adm-fcr-sub">
        {row.reportCount} open {row.reportCount === 1 ? 'report' : 'reports'}
        {row.newestReportAt ? <span className="adm-fcr-when"> · newest {formatReportTime(row.newestReportAt)}</span> : null}
      </h3>
      {row.reasons.length ? (
        <ul className="adm-fcr-reasons" aria-label="What reporters wrote">
          {row.reasons.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      ) : <p className="adm-hint">The reporters gave no reason.</p>}
      {mine ? (
        <div className="adm-fcr-confirm" role="group" aria-labelledby={`fcr-confirm-${row.claimId}`} tabIndex={-1} data-confirm-for={row.claimId}>
          <p id={`fcr-confirm-${row.claimId}`}>{ask.question}</p>
          <div className="adm-actions">
            <button type="button" className="adm-btn tiny danger" disabled={busy} onClick={onConfirm}>{ask.yes}</button>
            <button type="button" className="adm-btn tiny ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="adm-actions">
          {row.hiddenAt ? null : trigger('hide', 'Hide claim', false)}
          {trigger('dismiss', 'Dismiss reports', false)}
          {trigger('remove', "Remove this video's shared results", true)}
        </div>
      )}
      {actionError && actionError.claimId === row.claimId ? <p className="adm-msg err" role="alert">{actionError.text}</p> : null}
    </li>
  );
}

/** The whole screen for a given state. No hooks: the state and the handlers come in. */
export function ReportsView({ state, onAsk, onCancel, onConfirm, onRetry, onPage }) {
  const { status, rows, total, offset, pageSize } = state;
  const showList = rows.length > 0 && status !== 'error';
  // An action error for a claim that is no longer listed has no card to sit in, so it shows at the top.
  const orphanError = state.actionError && !rows.some((r) => r.claimId === state.actionError.claimId);
  const last = Math.min(offset + pageSize, total);
  return (
    <section aria-labelledby="fcr-title" className="adm-fcr">
      <h1 id="fcr-title" className="adm-h1" tabIndex={-1}>Fact-check reports</h1>
      <p className="adm-lede">
        Shared fact-check claims that users have reported. Hiding a claim removes it from other users&apos; view; dismissing marks the reports handled and leaves the claim.
      </p>
      {orphanError ? <p className="adm-msg err" role="alert">{state.actionError.text}</p> : null}
      {state.notice ? <p className="adm-msg" role="status">{state.notice}</p> : null}
      {status === 'loading' && !showList ? <p className="adm-lede" role="status">Loading reports…</p> : null}
      {status === 'error' ? (
        <div className="adm-fcr-error" role="alert">
          <p className="adm-msg err">{LOAD_ERROR}</p>
          <button type="button" className="adm-btn tiny" onClick={onRetry}>Try again</button>
        </div>
      ) : null}
      {status === 'ready' && rows.length === 0 ? <p className="adm-lede">No open reports.</p> : null}
      {showList ? <ul className="adm-fcr-list">{rows.map((row) => renderClaim(row, { state, onAsk, onCancel, onConfirm }))}</ul> : null}
      {status !== 'error' && total > pageSize ? (
        <nav className="adm-pager" aria-label="Pages of reports">
          <button type="button" className="adm-btn ghost" disabled={offset <= 0 || status === 'loading'} onClick={() => onPage(Math.max(0, offset - pageSize))}>Previous</button>
          <span className="adm-hint">{offset + 1}–{last} of {total}</span>
          <button type="button" className="adm-btn ghost" disabled={offset + pageSize >= total || status === 'loading'} onClick={() => onPage(offset + pageSize)}>Next</button>
        </nav>
      ) : null}
    </section>
  );
}

export function FactcheckReportsPage() {
  const controller = useMemo(() => createReportsController(supabase, { pageSize: PAGE_SIZE }), []);
  const [state, setState] = useState(controller.getState());
  const root = useRef(null);
  const lastTrigger = useRef(null);

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => { void controller.load(); }, [controller]);

  // Focus follows the question: into the confirmation when it opens, back to the button that opened it when it closes.
  const pendingKey = state.pending ? `${state.pending.claimId}:${state.pending.kind}` : '';
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (pendingKey) {
      lastTrigger.current = pendingKey;
      [...el.querySelectorAll('[data-confirm-for]')].find((n) => n.dataset.confirmFor === state.pending.claimId)?.focus();
    } else if (lastTrigger.current) {
      const key = lastTrigger.current;
      lastTrigger.current = null;
      const back = [...el.querySelectorAll('[data-trigger]')].find((n) => n.dataset.trigger === key);
      (back || el.querySelector('#fcr-title'))?.focus();
    }
  }, [pendingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={root}>
      <ReportsView
        state={state}
        onAsk={controller.ask}
        onCancel={controller.cancel}
        onConfirm={() => { void controller.confirm(); }}
        onRetry={() => { void controller.load(); }}
        onPage={(offset) => { void controller.goTo(offset); }}
      />
    </div>
  );
}

export default FactcheckReportsPage;
