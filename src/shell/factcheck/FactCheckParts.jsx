// F344 S3: "Checked parts of this video": results other sessions (or the user, earlier) saved for a
// recorded video. A part is one session's run. Own and unlocked parts open to a transcript and
// verdict cards; a locked part shows only its price. Nothing here is invented: every word of a part
// comes from the server's answer, and a locked part is never shown any text.
import { useEffect, useRef, useState } from 'react';
import { creditsText } from '../../lib/creditsStore.js';
import { earlierAnalysisIds, formatPosition, partModel } from './factCheckShare.js';
import { REANALYZE_LABEL, earlierAnalysisText } from './factCheckText.js';
import { HighlightedText, TRANSCRIPT_TEXT, TranscriptBar, useTranscriptTools } from './TranscriptTools.jsx';
import { useAnnounce } from './announce.jsx';

// Focus goes to the first control when a confirmation or form opens, and back to the button when it closes.
function useOpenCloseFocus(open) {
  const trigger = useRef(null);
  const first = useRef(null);
  const was = useRef(open);
  useEffect(() => {
    if (open) first.current?.focus();
    else if (was.current) trigger.current?.focus();
    was.current = open;
  }, [open]);
  return { trigger, first };
}

/** "Report this verdict" with an optional short reason; "Reported" once sent (or already reported). */
export function ReportControls({ id, report, onAsk, onCancel, onSend }) {
  const phase = report?.phase || 'idle';
  const [reason, setReason] = useState('');
  const { trigger, first } = useOpenCloseFocus(phase === 'asking' || phase === 'running');
  if (phase === 'done') return <p className="fc-reported">Reported</p>;
  return (
    <div className="fc-report">
      {report?.error ? <p className="fc-recheck-note fc-recheck-note--error">{report.error}</p> : null}
      {phase === 'running' ? <p className="fc-rechecking">Sending…</p> : null}
      {phase === 'asking' ? (
        <div className="fc-report-form">
          <label htmlFor={`fc-reason-${id}`}>Why? (optional)</label>
          <input
            id={`fc-reason-${id}`} className="fc-reason-input" type="text" maxLength={300} value={reason} ref={first}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="fc-actions">
            <button type="button" className="ltv-action-btn primary fc-btn" data-fc="report-send" onClick={() => onSend(id, reason)}>Send report</button>
            <button type="button" className="ltv-action-btn fc-btn" data-fc="report-cancel" onClick={() => onCancel(id)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          type="button" className="ltv-action-btn fc-btn fc-report-btn" data-fc="report" data-claim={id} ref={trigger}
          aria-disabled={phase === 'running' ? 'true' : undefined}
          onClick={() => { if (phase !== 'running') onAsk(id); }}
        >
          Report this verdict
        </button>
      )}
    </div>
  );
}

function UnlockControls({ model, price, balance, state, actions }) {
  const phase = state?.phase || 'idle';
  const { trigger, first } = useOpenCloseFocus(phase === 'confirming');
  const known = typeof balance === 'number';
  const short = known && balance < price;
  return (
    <div className="fc-recheck">
      {state?.notice ? <p className="fc-recheck-note">{state.notice}</p> : null}
      {state?.error ? <p className="fc-recheck-note fc-recheck-note--error">{state.error}</p> : null}
      {phase === 'running' ? <p className="fc-rechecking">Unlocking…</p> : null}
      {phase === 'confirming' ? (
        <div className="fc-confirm" role="group" aria-label="Unlock this part">
          <p>{`Unlock this part for ${creditsText(price)}?`}</p>
          <p>{known ? `Your balance is ${creditsText(balance)}.` : 'Your balance could not be read.'}</p>
          {short ? <p className="fc-confirm-why">{`Needs ${creditsText(price)}; you have ${creditsText(balance)}.`}</p> : null}
          <div className="fc-actions">
            <button type="button" className="ltv-action-btn primary fc-btn" data-fc="unlock-confirm" disabled={short} ref={first} onClick={() => actions.unlockConfirm?.(model.id, price)}>Unlock</button>
            <button type="button" className="ltv-action-btn fc-btn" data-fc="unlock-cancel" onClick={() => actions.unlockCancel?.(model.id)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          type="button" id={`fc-unlock-${model.id}`} className="ltv-action-btn fc-btn" data-fc="unlock" data-part={model.id} ref={trigger}
          aria-disabled={phase === 'running' ? 'true' : undefined}
          onClick={() => { if (phase !== 'running') actions.unlockAsk?.(model.id); }}
        >
          {model.priceLabel}
        </button>
      )}
    </div>
  );
}

// The stored lines of one readable part, with the same search, Copy and Download as the live transcript.
function PartLines({ lines, title, date }) {
  const rows = lines.map((l, i) => ({ key: i, time: formatPosition(l.pos_start_s), text: String(l.text ?? '') }));
  const tools = useTranscriptTools({ lines: rows, title, date, say: useAnnounce() });
  const searching = tools.query.trim() !== '';
  return (
    <>
      <TranscriptBar tools={tools} total={rows.length} landmark={false} label={TRANSCRIPT_TEXT.partSearchLabel} />
      <div className="fc-part-lines">
        {tools.noMatch ? <p className="fc-empty">{`${TRANSCRIPT_TEXT.noMatch}. Clear the search to see every line.`}</p> : null}
        {tools.shown.map((l) => (
          <p className="fc-line" dir="auto" key={l.key}>
            <span className="fc-line-time">{l.time}</span>
            {searching ? <>{' '}<HighlightedText text={l.text} query={tools.query} /></> : ` ${l.text}`}
          </p>
        ))}
      </div>
    </>
  );
}

export function Part({ stretch, open, onToggle, balance, state, actions, renderCard, earlier = false, title = '' }) {
  const m = partModel(stretch);
  const meta = [m.minutes, m.date && !earlier && `Checked on ${m.date}`, m.claimsLabel].filter(Boolean).join(' · ');
  return (
    <li className="fc-part" data-part={m.id} data-access={m.access}>
      <div className="fc-card-head">
        <span className="fc-part-range">{m.range}</span>
        {m.access === 'own' ? <span className="fc-kind">Your check</span> : null}
        {m.access === 'unlocked' ? <span className="fc-kind">Unlocked</span> : null}
        {earlier ? <span className="fc-kind fc-kind--earlier">{earlierAnalysisText(m.date)}</span> : null}
      </div>
      {meta ? <p className="fc-by">{meta}</p> : null}
      {m.readable ? (
        <>
          {actions?.reanalyze ? (
            <button type="button" className="ltv-action-btn fc-btn fc-reanalyze-btn" data-fc="reanalyze" data-part={m.id} aria-label={`${REANALYZE_LABEL}, ${m.range}`} onClick={() => actions.reanalyze(m.id)}>
              {REANALYZE_LABEL}
            </button>
          ) : null}
          <button type="button" className="fc-part-toggle" aria-expanded={open} aria-controls={`fc-part-${m.id}`} onClick={() => onToggle(m.id)}>
            {open ? 'Hide transcript and verdicts' : 'Show transcript and verdicts'}
          </button>
          <div className="fc-part-body" id={`fc-part-${m.id}`} hidden={!open}>
            {m.lines.length ? <PartLines lines={m.lines} title={title} date={stretch.checked_on} /> : null}
            <ol className="fc-claims" aria-label="Claims in this part">
              {m.claims.map((c) => renderCard(c, m))}
            </ol>
          </div>
        </>
      ) : (
        <UnlockControls model={m} price={m.price ?? 0} balance={balance} state={state} actions={actions} />
      )}
    </li>
  );
}

/** The section. `view.shared` is the controller's state; `renderCard(claim, partModel)` draws a card. */
export function Parts({ shared, balance, openIds, onToggle, actions, renderCard, title = '' }) {
  const earlier = earlierAnalysisIds(shared.stretches);
  return (
    <section className="fc-parts" aria-labelledby="fc-parts-title">
      <h4 id="fc-parts-title" className="fc-section">Checked parts of this video</h4>
      <p className="fc-by">This text comes from another user’s run of this video. You can report a verdict that looks wrong.</p>
      {shared.phase === 'loading' && shared.stretches.length === 0 ? <p className="fc-empty">Loading checked parts…</p> : null}
      {shared.phase === 'error' ? (
        <>
          <p className="fc-recheck-note fc-recheck-note--error">{shared.error}</p>
          <button type="button" className="ltv-action-btn fc-btn" data-fc="parts-retry" onClick={() => actions.reload?.()}>Try again</button>
        </>
      ) : null}
      {shared.phase === 'ready' && shared.stretches.length === 0 ? <p className="fc-empty">No part of this video has been checked yet.</p> : null}
      {shared.stretches.length ? (
        <ol className="fc-part-list" aria-label="Checked parts">
          {shared.stretches.map((s) => (
            <Part
              key={s.stretch_id} stretch={s} open={Boolean(openIds[s.stretch_id])} onToggle={onToggle} balance={balance}
              state={shared.unlocks[s.stretch_id]} actions={actions} renderCard={renderCard} earlier={earlier.has(s.stretch_id)} title={title}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/** "This part is already checked": offered before a new block when a part covers the current position. */
export function CoveredBanner({ model, onShow, onAnyway, onCancel }) {
  return (
    <div className="fc-covered" role="group" aria-label="This part is already checked">
      <p><strong>This part is already checked:</strong>{` ${model.range}.`}</p>
      <p>{model.readable ? 'You can read it instead of paying for a new check.' : `You can read it instead of paying for a new check. It costs ${creditsText(model.price ?? 0)} to unlock.`}</p>
      <div className="fc-actions">
        <button type="button" className="ltv-action-btn primary fc-btn" data-fc="part-show" onClick={() => onShow(model.id)}>Show that part</button>
        <button type="button" className="ltv-action-btn fc-btn" data-fc="part-anyway" onClick={onAnyway}>Check anyway</button>
        <button type="button" className="ltv-action-btn fc-btn" data-fc="cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
