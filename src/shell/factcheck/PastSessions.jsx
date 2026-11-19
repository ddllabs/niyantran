// F360 T3: "Past sessions" on the Live TV page. PastSessionsView is a function of the hook's state, so every
// state renders without a network. Read-only claim cards are the panel's own card (no price, no share).
// Styles: factCheck.css (pst- classes), pulled in by liveTv.css.
import { useEffect, useRef } from 'react';
import { creditsText } from '../../lib/creditsStore.js';
import { ClaimCard } from './FactCheckPanel.jsx';
import { ExportButton } from './ClaimExport.jsx';
import { exportFileName, sessionExportText } from './claimExport.js';
import { PAST_TEXT, minutesText } from './factCheckText.js';
import { CLAIM_CAP } from './pastSessions.js';
import { usePastSessions } from './usePastSessions.js';

function startedAt(iso) {
  const d = new Date(iso);
  if (typeof iso !== 'string' || Number.isNaN(d.getTime())) return null;
  return <time dateTime={iso}>{d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>;
}

function channelLabel(id, channels) {
  const found = Array.isArray(channels) ? channels.find((c) => c?.id === id) : null;
  return (typeof found?.name === 'string' && found.name) || id || PAST_TEXT.unknownChannel;
}

// The delete control of one live session: Delete, then the question with Delete and Keep. Focus goes to
// Keep when the question opens, and back to Delete when it is dismissed.
export function DeleteControl({ session, removal, onAsk, onCancel, onConfirm }) {
  const own = removal && removal.id === session.id ? removal : null;
  const asking = Boolean(own && (own.phase === 'confirm' || own.phase === 'busy'));
  const ask = useRef(null);
  const keep = useRef(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking && !wasAsking.current) keep.current?.focus();
    else if (!asking && wasAsking.current) ask.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  if (asking) {
    const busy = own.phase === 'busy';
    return (
      <div className="pst-confirm" role="group" aria-label={PAST_TEXT.deleteAsk}>
        <p>{PAST_TEXT.deleteAsk}</p>
        <p className="pst-note">{PAST_TEXT.deleteNoRefund}</p>
        {busy ? <p className="pst-note">{PAST_TEXT.deleting}</p> : null}
        <div className="fc-actions">
          <button type="button" className="ltv-action-btn pst-danger" data-pst="confirm" disabled={busy} onClick={() => onConfirm(session.id)}>{PAST_TEXT.deleteConfirm}</button>
          <button type="button" className="ltv-action-btn" data-pst="keep" disabled={busy} ref={keep} onClick={onCancel}>{PAST_TEXT.deleteKeep}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="pst-delete">
      {own?.phase === 'error' ? <p className="pst-error" role="alert">{PAST_TEXT.deleteError}</p> : null}
      <button type="button" className="ltv-action-btn" data-pst="delete" ref={ask} onClick={() => onAsk(session.id)}>{PAST_TEXT.delete}</button>
    </div>
  );
}

function Detail({ session, state, past, source }) {
  const id = `pst-detail-${session.id}`;
  let body;
  if (!state || state.phase === 'loading') {
    body = <p className="fc-empty">{PAST_TEXT.detailLoading}</p>;
  } else if (state.phase === 'error') {
    body = (
      <>
        <p className="pst-error" role="alert">{PAST_TEXT.detailError}</p>
        <button type="button" className="ltv-action-btn" data-pst="retry-detail" onClick={() => past.retryDetail(session.id)}>{PAST_TEXT.tryAgain}</button>
      </>
    );
  } else if (state.claims.length === 0) {
    body = <p className="fc-empty">{PAST_TEXT.detailEmpty}</p>;
  } else {
    body = (
      <>
        <ol className="fc-claims" aria-label="Claims">
          {state.claims.map((c) => <ClaimCard key={c.id} claim={c} source={source} copyKey="pst" />)}
        </ol>
        <div className="fc-card-actions">
          <ExportButton
            dataKey="pst"
            build={() => ({
              name: exportFileName({ title: source, date: session.started_at }),
              text: sessionExportText({
                title: source, date: session.started_at, minutes: session.minutes_used,
                items: state.claims.map((c) => ({ claim: c, shown: c })),
              }),
            })}
          />
        </div>
        {state.capped ? <p className="pst-note">{PAST_TEXT.capped(CLAIM_CAP)}</p> : null}
      </>
    );
  }
  return <div className="pst-detail" id={id}>{body}</div>;
}

function Row({ session, channels, past }) {
  const open = past.openId === session.id;
  const live = session.video_kind === 'live';
  const used = typeof session.minutes_used === 'number' ? minutesText(session.minutes_used) : null;
  const charged = typeof session.credits_charged === 'number' ? creditsText(session.credits_charged) : null;
  return (
    <li className="pst-row">
      <button
        type="button"
        className="pst-toggle"
        data-pst="row"
        aria-expanded={open}
        aria-controls={`pst-detail-${session.id}`}
        onClick={() => past.toggle(session.id)}
      >
        <span className="pst-when">{startedAt(session.started_at)}</span>
        <span className="pst-channel">{channelLabel(session.channel_id, channels)}</span>
        <span className="pst-kind">{live ? PAST_TEXT.live : PAST_TEXT.recorded}</span>
        {used ? <span className="pst-used">{used}</span> : null}
        {charged ? <span className="pst-charged">{charged}</span> : null}
      </button>
      {open ? (
        <>
          <Detail session={session} state={past.details[session.id]} past={past} source={channelLabel(session.channel_id, channels)} />
          {live
            ? <DeleteControl session={session} removal={past.removal} onAsk={past.askDelete} onCancel={past.cancelDelete} onConfirm={past.confirmDelete} />
            : <p className="pst-note">{PAST_TEXT.recordedKept}</p>}
        </>
      ) : null}
    </li>
  );
}

/** The section as a function of the hook's state. */
export function PastSessionsView({ past, channels }) {
  const heading = useRef(null);
  const announced = past.notice === 'deleted';
  // After a deletion the row (and its focused button) is gone: focus moves to the heading.
  useEffect(() => { if (announced) heading.current?.focus(); }, [announced]);
  let body;
  if (past.phase === 'loading') {
    body = <p className="fc-empty">{PAST_TEXT.loading}</p>;
  } else if (past.phase === 'error') {
    body = (
      <>
        <p className="pst-error" role="alert">{PAST_TEXT.loadError}</p>
        <button type="button" className="ltv-action-btn" data-pst="retry" onClick={past.retry}>{PAST_TEXT.tryAgain}</button>
      </>
    );
  } else if (past.rows.length === 0) {
    body = <p className="fc-empty">{PAST_TEXT.empty}</p>;
  } else {
    body = (
      <>
        <ul className="pst-list">
          {past.rows.map((s) => <Row key={s.id} session={s} channels={channels} past={past} />)}
        </ul>
        {past.moreFailed ? <p className="pst-error" role="alert">{PAST_TEXT.moreError}</p> : null}
        {past.hasMore ? (
          <button type="button" className="ltv-action-btn" data-pst="more" disabled={past.moreBusy} onClick={past.showMore}>
            {past.moreBusy ? PAST_TEXT.showingMore : PAST_TEXT.showMore}
          </button>
        ) : null}
      </>
    );
  }
  return (
    <section className="pst" aria-labelledby="pst-heading">
      <h3 className="pst-heading" id="pst-heading" tabIndex={-1} ref={heading}>{PAST_TEXT.heading}</h3>
      <p className="pst-note">{PAST_TEXT.intro}</p>
      <p className="pst-status" role="status" aria-live="polite">{announced ? PAST_TEXT.deleted : ''}</p>
      {body}
    </section>
  );
}

function PastSessionsBody({ sessionStatus, channels }) {
  const past = usePastSessions({ sessionStatus });
  return <PastSessionsView past={past} channels={channels} />;
}

/** Renders nothing, and reads nothing, unless the fact-check flag is on for this account (D3). */
export function PastSessions({ enabled, userId, sessionStatus, channels }) {
  if (!enabled) return null;
  // Keyed on the account, so another account's rows are never carried over.
  return <PastSessionsBody key={userId || 'none'} sessionStatus={sessionStatus} channels={channels} />;
}
