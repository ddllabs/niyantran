// F344 T6: the Live TV fact-check panel. A function of the view the controller publishes, so every
// state can be rendered without a network or a browser capture. ADR 0006 holds: the panel shows
// only text a provider returned and verdicts a check returned; where there is nothing it says so.
// Styles: factCheck.css is pulled in by liveTv.css (@import), because a lazy chunk may not carry a
// stylesheet of its own (scripts/check-bundle.mjs) and terminalStyles.js is generated.
import { useEffect, useRef, useState } from 'react';
import { creditsText, formatCredits } from '../../lib/creditsStore.js';
import {
  blockOptions, claimBadge, confirmStart, endReasonText, errorMessage, formatClock, kindTag, safeSourceUrl, sourceLabel,
} from './factCheckText.js';

const SILENT_NOTICE_MS = 30000;

/**
 * The "Fact-check" button with its price; a quiet note when the browser cannot do it or the video is
 * not playing; null when the feature is off, nothing is playing, or a session is on screen.
 */
export function FactCheckEntry({ view, playable = true, onChoose }) {
  if (!view?.flag?.available || !view.ready || view.session.status !== 'idle') return null;
  if (!view.supported) {
    return <span className="fc-note" role="note">Fact-check is available on Chrome on a computer</span>;
  }
  if (!playable) return <span className="fc-note" role="note">Play the video to fact-check it</span>;
  return (
    <button
      type="button"
      id="fc-entry"
      className="ltv-action-btn fc-entry"
      data-fc="open"
      onClick={onChoose}
      title="Check the claims made in this video, live"
    >
      {`Fact-check · ${creditsText(view.flag.creditsPerMinute)} a minute`}
    </button>
  );
}

function MutedWarning({ onUnmute }) {
  return (
    <div className="fc-warning" role="alert">
      <p><strong>The video is muted.</strong> Fact-check listens to the tab’s sound, so unmute the video first.</p>
      <button type="button" className="ltv-action-btn fc-btn" data-fc="unmute" onClick={onUnmute}>Unmute video</button>
    </div>
  );
}

function Choose({ view, isMuted, onUnmute, onConfirm, onCancel }) {
  const [preferred, setPreferred] = useState(null);
  const balance = typeof view.balance === 'number' ? view.balance : null;
  const options = blockOptions(view.flag.creditsPerMinute, balance);
  const chosen = options.find((o) => o.minutes === preferred && o.affordable) || options.find((o) => o.affordable) || null;
  return (
    <div className="fc-choose">
      <p className="fc-balance">
        {balance === null ? 'Your balance could not be read.' : `Available credits: ${formatCredits(balance)}`}
      </p>
      {view.priceNotice ? <p className="fc-notice" role="status">{view.priceNotice}</p> : null}
      {view.orphanNotice ? <p className="fc-notice" role="status">{view.orphanNotice}</p> : null}
      {isMuted ? <MutedWarning onUnmute={onUnmute} /> : null}
      <div className="fc-options" role="group" aria-label="Block length">
        {options.map((o) => (
          <button
            type="button"
            key={o.minutes}
            className="fc-option"
            data-minutes={o.minutes}
            aria-pressed={chosen?.minutes === o.minutes}
            disabled={!o.affordable}
            onClick={() => setPreferred(o.minutes)}
          >
            <span className="fc-option-minutes">{`${o.minutes} minutes`}</span>
            <span className="fc-option-price">{creditsText(o.price)}</span>
            {o.affordable ? null : (
              <span className="fc-option-why">{`Needs ${creditsText(o.price)}; you have ${formatCredits(balance)}`}</span>
            )}
          </button>
        ))}
      </div>
      <ul className="fc-facts">
        <li>Your browser will ask to share this tab’s audio.</li>
        <li>The whole block is held from your credits when you start.</li>
        <li>Each minute that starts is charged in full, with a one-minute minimum. Silence counts as use.</li>
        <li>Unused whole minutes are released when the session ends.</li>
        <li>Closing Live TV ends the session.</li>
        <li>The video must be unmuted.</li>
      </ul>
      <div className="fc-actions">
        <button
          type="button"
          className="ltv-action-btn primary fc-btn"
          data-fc="confirm"
          disabled={!chosen}
          onClick={() => chosen && confirmStart({ isMuted, onUnmute, onConfirm }, chosen.minutes, view.flag.creditsPerMinute)}
        >
          {chosen ? `${isMuted ? 'Unmute and start' : 'Start'} ${chosen.minutes} minutes · ${creditsText(chosen.price)}` : 'Start'}
        </button>
        <button type="button" className="ltv-action-btn fc-btn" data-fc="cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Waiting({ status, onStop }) {
  return (
    <div className="fc-waiting">
      {status === 'sharing' ? (
        <>
          <p>Waiting for your browser’s sharing prompt.</p>
          <p>In Chrome’s prompt choose “This tab” and keep tab audio switched on.</p>
        </>
      ) : (
        <>
          <p>Starting the session…</p>
          <p>Cancelling now may still be charged the one-minute minimum.</p>
        </>
      )}
      <div className="fc-actions">
        <button type="button" className="ltv-action-btn fc-btn" data-fc="cancel" onClick={onStop}>
          {status === 'sharing' ? 'Cancel' : 'Stop (one-minute minimum)'}
        </button>
      </div>
    </div>
  );
}

// Keeps the newest line in view until the reader scrolls up; a button brings them back.
function Transcript({ lines, emptyText }) {
  const box = useRef(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const tail = lines.length ? `${lines.length}:${lines[lines.length - 1].text.length}` : '';
  useEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [tail]);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    follow.current = near;
    setAway(!near);
  };
  const jump = () => {
    const el = box.current;
    follow.current = true;
    if (el) el.scrollTop = el.scrollHeight;
    setAway(false);
  };
  return (
    <div className="fc-transcript-wrap">
      <div className="fc-transcript" role="region" aria-label="Transcript" aria-live="off" tabIndex={0} ref={box} onScroll={onScroll}>
        {lines.length === 0 ? <p className="fc-empty">{emptyText}</p> : lines.map((l) => <p className="fc-line" dir="auto" key={l.seq}>{l.text}</p>)}
      </div>
      {away ? <button type="button" className="ltv-action-btn fc-btn fc-jump" onClick={jump}>Jump to latest</button> : null}
    </div>
  );
}

function checkedTime(iso, withDate = false) {
  const d = new Date(iso);
  if (typeof iso !== 'string' || Number.isNaN(d.getTime())) return null;
  return withDate
    ? d.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function SourceList({ result }) {
  const items = (Array.isArray(result.sources) ? result.sources : []).flatMap((s, i) => {
    const href = safeSourceUrl(s?.url);
    const title = typeof s?.title === 'string' ? s.title.trim() : '';
    if (href) {
      return [<li key={i}><a href={href} target="_blank" rel="noopener noreferrer">{sourceLabel(s)}</a></li>];
    }
    return title ? [<li key={i}><span>{title}</span></li>] : [];
  });
  return items.length ? <ul className="fc-sources" aria-label="Sources">{items}</ul> : null;
}

// A re-checked card and its earlier results show the date too: they were checked at different times.
function CheckedAt({ result, withDate = false }) {
  const time = result.checked_at ? checkedTime(result.checked_at, withDate) : null;
  return time ? <p className="fc-time"><time dateTime={result.checked_at}>{`Checked ${time}`}</time></p> : null;
}

// The "Earlier result" disclosure: a button that shows or hides the older results, newest first.
function Earlier({ id, items }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fc-earlier-toggle" aria-expanded={open} aria-controls={`fc-earlier-${id}`} onClick={() => setOpen((o) => !o)}>
        {items.length === 1 ? 'Earlier result' : `Earlier results (${items.length})`}
      </button>
      <ol className="fc-earlier" id={`fc-earlier-${id}`} hidden={!open}>
        {items.map((r) => {
          const b = claimBadge(r);
          return (
            <li className="fc-earlier-item" key={r.id}>
              <span className={`fc-badge fc-badge--${b.key}`}>
                <span className="fc-glyph" aria-hidden="true">{b.glyph}</span>
                {` ${b.label}`}
              </span>
              {r.reason ? <p className="fc-reason" dir="auto">{r.reason}</p> : null}
              <SourceList result={r} />
              <CheckedAt result={r} withDate />
            </li>
          );
        })}
      </ol>
    </>
  );
}

// "Check again": a button, an inline confirmation with the price and the balance, progress, and the
// outcome. Focus goes to Confirm when the confirmation opens and back to the button when it closes.
function RecheckControls({ id, price, balance, recheck, onAsk, onConfirm, onCancel }) {
  const phase = recheck?.phase || 'idle';
  const button = useRef(null);
  const confirmButton = useRef(null);
  const previous = useRef(phase);
  useEffect(() => {
    if (phase === 'confirming') confirmButton.current?.focus();
    else if (previous.current === 'confirming') button.current?.focus();
    previous.current = phase;
  }, [phase]);
  const known = typeof balance === 'number';
  const short = known && balance < price;
  if (recheck?.locked) {
    return <div className="fc-recheck">{recheck.error ? <p className="fc-recheck-note fc-recheck-note--error">{recheck.error}</p> : null}</div>;
  }
  return (
    <div className="fc-recheck">
      {recheck?.notice ? <p className="fc-recheck-note">{recheck.notice}</p> : null}
      {recheck?.error ? <p className="fc-recheck-note fc-recheck-note--error">{recheck.error}</p> : null}
      {phase === 'running' ? <p className="fc-rechecking">Checking again…</p> : null}
      {phase === 'confirming' ? (
        <div className="fc-confirm" role="group" aria-label="Check this claim again">
          <p>{`Check this claim again for ${creditsText(price)}?`}</p>
          <p>{known ? `Your balance is ${creditsText(balance)}.` : 'Your balance could not be read.'}</p>
          {short ? <p className="fc-confirm-why">{`Needs ${creditsText(price)}; you have ${creditsText(balance)}.`}</p> : null}
          <div className="fc-actions">
            <button type="button" className="ltv-action-btn primary fc-btn" data-fc="recheck-confirm" disabled={short} ref={confirmButton} onClick={() => onConfirm(id, price)}>Check again</button>
            <button type="button" className="ltv-action-btn fc-btn" data-fc="recheck-cancel" onClick={() => onCancel(id)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          id={`fc-recheck-${id}`}
          className="ltv-action-btn fc-btn fc-recheck-btn"
          data-fc="recheck"
          data-claim={id}
          aria-disabled={phase === 'running' ? 'true' : undefined}
          ref={button}
          onClick={() => { if (phase !== 'running') onAsk(id); }}
        >
          {`Check again · ${creditsText(price)}`}
        </button>
      )}
    </div>
  );
}

function Card({ claim, price, balance, recheck, onAsk, onConfirm, onCancel }) {
  // With no re-check price the card is exactly what it was before re-checks existed.
  const priced = typeof price === 'number';
  const chain = priced && recheck?.results?.length ? [...recheck.results, claim] : [claim];
  const shown = chain[0];
  const badge = claimBadge(shown);
  const tag = kindTag(claim, badge);
  const by = [claim.claimant && `Claim by ${claim.claimant}`, claim.reported_by && `reported by ${claim.reported_by}`]
    .filter(Boolean).join(', ');
  return (
    <li className={`fc-card fc-card--${badge.key}`}>
      <div className="fc-card-head">
        <span className={`fc-badge fc-badge--${badge.key}`}>
          <span className="fc-glyph" aria-hidden="true">{badge.glyph}</span>
          {` ${badge.label}`}
        </span>
        {tag ? <span className="fc-kind">{tag}</span> : null}
      </div>
      <p className="fc-claim" dir="auto">{claim.claim_en}</p>
      {by ? <p className="fc-by">{by}</p> : null}
      {shown.reason ? <p className="fc-reason" dir="auto">{shown.reason}</p> : null}
      <SourceList result={shown} />
      <CheckedAt result={shown} withDate={chain.length > 1} />
      {priced && (shown.status === 'checked' || shown.status === 'error') ? (
        <RecheckControls id={claim.id} price={price} balance={balance} recheck={recheck} onAsk={onAsk} onConfirm={onConfirm} onCancel={onCancel} />
      ) : null}
      {chain.length > 1 ? <Earlier id={claim.id} items={chain.slice(1)} /> : null}
    </li>
  );
}

function Claims({ claims, emptyText, recheck }) {
  return (
    <>
      <h4 className="fc-section">{`Claims (${claims.length})`}</h4>
      {claims.length === 0 ? <p className="fc-empty">{emptyText}</p> : (
        <ol className="fc-claims" aria-label="Claims">
          {[...claims].reverse().map((c) => (
            <Card key={c.id} claim={c} price={recheck.price} balance={recheck.balance} recheck={recheck.states[c.id]}
              onAsk={recheck.onAsk} onConfirm={recheck.onConfirm} onCancel={recheck.onCancel} />
          ))}
        </ol>
      )}
    </>
  );
}

function Final({ final, sessionId }) {
  if (!final) {
    return sessionId ? <p className="fc-final-note">The final amount is not shown here. Check your balance.</p> : null;
  }
  const rows = [];
  if (typeof final.minutes_used === 'number') rows.push(['Used', `${final.minutes_used} ${final.minutes_used === 1 ? 'minute' : 'minutes'}`]);
  if (typeof final.credits_charged === 'number') rows.push(['Charged', creditsText(final.credits_charged)]);
  if (typeof final.balance === 'number') rows.push(['New balance', creditsText(final.balance)]);
  return (
    <dl className="fc-final">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

/** The right-hand panel. Renders nothing while idle or when the flag is off. */
export function FactCheckPanel(props) {
  if (!props.view?.flag?.available) return null;
  // Idle shows only if a re-check message has to outlive the session (a late charge, switched off).
  if (props.view.session.status === 'idle' && !props.view.recheckNotices?.length) return null;
  return <PanelBody {...props} />;
}

// Mounted while a session is on screen: focus moves to the heading when it opens, and back to the
// entry button when it is dismissed (unless the user has already moved focus elsewhere).
function PanelBody({ view, isMuted, onUnmute, onConfirm, onCancel, onStop, onRetry, onDismiss, onEndOrphan, onRecheckAsk, onRecheckConfirm, onRecheckCancel }) {
  const heading = useRef(null);
  const opensForNotice = useRef(view.session.status === 'idle'); // a late message must not take focus
  useEffect(() => {
    if (!opensForNotice.current) heading.current?.focus();
    return () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body) document.getElementById('fc-entry')?.focus();
      }, 0);
    };
  }, []);
  const s = view.session;
  const live = s.status === 'running' || s.status === 'ending';
  const hasContent = s.transcript.length > 0 || s.claims.length > 0;
  const showWork = live || s.status === 'ended' || (s.status === 'error' && hasContent);
  const gaps = s.skippedPieces > 0 || s.droppedTurns > 0;
  const problem = s.status === 'error' ? errorMessage(s.error) : null;
  return (
    <section className="fc-panel" aria-label="Fact-check" data-status={s.status}>
      <div className="fc-sr" aria-live="polite" aria-atomic="true">{view.announcement}</div>
      <header className="fc-head">
        <h3 id="fc-title" className="fc-title" tabIndex={-1} ref={heading}>Fact-check</h3>
        {live ? (
          <div className="fc-head-run">
            <span className="fc-clock">{s.status === 'ending' ? 'Finishing…' : `${formatClock(s.secondsLeft)} left`}</span>
            <button type="button" className="ltv-action-btn fc-btn" data-fc="stop" disabled={s.status === 'ending'} onClick={onStop}>Stop</button>
          </div>
        ) : null}
      </header>

      {s.creditsPerMinute != null && s.status !== 'choosing' && s.status !== 'sharing' && s.status !== 'starting' ? (
        <p className="fc-rate">
          {`${creditsText(s.creditsPerMinute)} a minute${s.creditsHeld != null ? ` · ${creditsText(s.creditsHeld)} held` : ''}`}
        </p>
      ) : null}

      {view.recheckNotices?.length ? (
        <div className="fc-notices">
          {view.recheckNotices.map((n, i) => <p className="fc-notice" role="note" key={i}>{n}</p>)}
          <button type="button" className="ltv-action-btn fc-btn" data-fc="notices-dismiss" onClick={view.recheckActions?.dismissNotices}>Close</button>
        </div>
      ) : null}

      {s.status === 'choosing' ? (
        <Choose view={view} isMuted={isMuted} onUnmute={onUnmute} onConfirm={onConfirm} onCancel={onCancel} />
      ) : null}
      {s.status === 'sharing' || s.status === 'starting' ? <Waiting status={s.status} onStop={onStop} /> : null}

      {s.status === 'running' && isMuted ? <MutedWarning onUnmute={onUnmute} /> : null}
      {s.status === 'running' && s.silentFor > SILENT_NOTICE_MS ? (
        <p className="fc-notice" role="note">No speech heard. Is the video muted or paused?</p>
      ) : null}
      {(live || s.status === 'ended') && s.budgetReached ? (
        <p className="fc-notice" role="note">
          The checking limit for this session was reached. The transcript continues; later claims are not checked.
        </p>
      ) : null}
      {showWork && gaps ? (
        <p className="fc-notice" role="note">Some audio could not be processed; the transcript has gaps.</p>
      ) : null}

      {s.status === 'ended' ? <p className="fc-ended">{endReasonText(s.endReason)}</p> : null}
      {problem ? (
        <div className="fc-error" role="alert">
          <p>{problem.text}</p>
          {s.error?.reason === 'already_active' && s.error.sessionId ? (
            <>
              {view.orphanFailed ? <p>Could not end that session. Try again.</p> : null}
              <button type="button" className="ltv-action-btn primary fc-btn" data-fc="orphan" onClick={onEndOrphan}>End that session</button>
            </>
          ) : null}
        </div>
      ) : null}
      {s.status === 'ended' || s.status === 'error' ? <Final final={s.final} sessionId={s.sessionId} /> : null}

      {showWork ? (
        <div className="fc-work">
          <h4 className="fc-section">Transcript</h4>
          <Transcript
            lines={s.transcript}
            emptyText={live ? 'Listening… Text appears about 13 seconds behind the speaker.' : 'No speech was transcribed.'}
          />
          <Claims
            claims={s.claims}
            emptyText={live ? 'No claims yet.' : 'No claims were found.'}
            recheck={{
              price: view.flag.recheckCredits ?? null, balance: view.balance, states: view.rechecks || {},
              onAsk: onRecheckAsk ?? view.recheckActions?.ask,
              onConfirm: onRecheckConfirm ?? view.recheckActions?.confirm,
              onCancel: onRecheckCancel ?? view.recheckActions?.cancel,
            }}
          />
        </div>
      ) : null}

      {s.status === 'ended' || s.status === 'error' ? (
        <div className="fc-actions">
          {s.status === 'ended' ? (
            <button type="button" className="ltv-action-btn primary fc-btn" data-fc="again" onClick={onRetry}>Run again</button>
          ) : null}
          {problem?.retry ? (
            <button type="button" className="ltv-action-btn primary fc-btn" data-fc="retry" onClick={onRetry}>Try again</button>
          ) : null}
          <button type="button" className="ltv-action-btn fc-btn" data-fc="dismiss" onClick={onDismiss}>Close</button>
        </div>
      ) : null}

      <p className="fc-disclaimer">Verdicts are automated, may be wrong, and should be checked against the sources shown.</p>
    </section>
  );
}
