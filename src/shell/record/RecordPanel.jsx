import { useEffect, useRef } from 'react';
import { deskHash } from '../../lib/deskRoute.js';
import { loadRecordAnimation, RECORD_ANIMATION_LOGO } from './recordAnimation.js';
import { RECORD_BRIEF_ANIMATION_MS } from './useRecordBrief.js';
import { VISUALS } from './visuals/index.js';
import './recordPanel.css';

/**
 * One record panel for every Global module (F121; docs/specs/2026-10-13-global-record-panels.md).
 * It renders a RecordPanelModel built by a module adapter: header, 01 at a glance, 02 about,
 * 03 related records, and a footer that names the provider and as-of date. A part the model lacks
 * is omitted; the panel never shows a placeholder or claims a live feed it is not.
 */

const safeHref = (href) => (/^https:\/\//i.test(String(href || '')) ? href : null);

const BRIEF_STATUS = {
  unavailable: 'AI brief not available yet',
  error: 'AI brief unavailable right now',
};

/** "15 Oct 2026", in India time; '' when the date is missing or invalid. */
function writtenDate(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** The ready brief's body: format 2 is the analysis box's lead, why, watch and tags; format 1 a headline and points. */
function BriefBody({ brief }) {
  if (Array.isArray(brief.points)) {
    // Format 1, stored before the format change and shown until it is regenerated.
    return (
      <>
        <div className="rd-ai-brief"><b>{brief.headline}</b></div>
        <ul className="rd-ai-bullets">{brief.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
      </>
    );
  }
  return (
    <>
      <div className="rd-ai-brief">{brief.brief}</div>
      {brief.why ? <div className="rd-ai-sub"><span>Why it matters</span>{brief.why}</div> : null}
      {brief.watch ? <div className="rd-ai-sub"><span>Watch for</span>{brief.watch}</div> : null}
      {brief.tags?.length ? (
        <div className="rd-ai-tags">{brief.tags.map((t, i) => <span key={i} className="rd-ai-tag">{t}</span>)}</div>
      ) : null}
    </>
  );
}

/**
 * The AI brief box (F123; owner decisions 2026-10-15). The brief is written from the record's own
 * fields the first time anyone opens it, stored, and shown to every later viewer, labelled with the
 * date it was written. It has the format and styling of the blue "Niyantran analysis" box (.rd-ai):
 * a lead brief, "Why it matters", "Watch for" and tag chips; a brief stored before that change (a
 * headline and points) is shown as such until it is regenerated. The box says plainly when it is
 * being written, not available or failed, and never shows template text as AI. `brief` is the state
 * from useRecordBrief; absent, or state 'none', means no box. Also shown by RecordDetail (in place
 * of its own analysis box) and NationalRecord's GenericRecord, the record views of modules without
 * a record-panel adapter.
 */
/**
 * F205 (owner 2026-10-16): the card tells reading the stored brief from writing a new one. Since F214
 * both play the animation below, and the fallback's words say which.
 */
/**
 * F211 (owner 2026-10-16): while a brief is written, the client's approved animation plays in the
 * card (public/animation, loaded on first use). The card's own writing look is its light-DOM content,
 * shown until the component is defined and if it never loads; once it runs, the look sits in the
 * component's hidden result slot. Unmounting cancels it. F214 (owner 2026-10-16): it plays every time,
 * while a stored brief is read too; only the fallback's words say which.
 */
function BriefAnimation({ writing }) {
  const host = useRef(null);
  useEffect(() => {
    let live = true;
    const el = host.current;
    loadRecordAnimation().then((ok) => {
      if (!ok || !live || typeof el?.load !== 'function') return;
      // The brief arrives through the hook, not through the component: its task only ends on cancel.
      const waitForCancel = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      el.load(waitForCancel, () => document.createTextNode(''), { label: 'Opening the AI brief for this record.', duration: RECORD_BRIEF_ANIMATION_MS }).catch(() => {});
    });
    return () => { live = false; el?.cancel?.(); };
  }, []);
  return (
    <div className="rp-brief-anim">
      <nter-record-loader ref={host} logo-src={RECORD_ANIMATION_LOGO}>
        <div className="rp-brief-writing" role="status"><span className="rp-brief-mark"><img src="/brand/logo-128.webp" alt="" width="20" height="20" /></span><span>{writing ? 'Writing the AI brief…' : 'Loading the AI brief…'}</span></div>
        <div className="rp-brief-skel is-writing" aria-hidden="true"><i /><i /><i /></div>
      </nter-record-loader>
    </div>
  );
}

export const isRecordBriefWaiting = (brief) => ['loading', 'writing', 'pending'].includes(brief?.state);

/** Occupies the selected-record content pane until its existing brief state settles. */
export function RecordPaneLoading({ brief, onClose }) {
  return (
    <section className="rp-record-loading" aria-label="Niyantran analysis" aria-busy="true">
      <button type="button" className="rp-close rp-record-loading-close" onClick={onClose} aria-label="Close record">×</button>
      <BriefAnimation key={brief.record} writing={brief.state !== 'loading'} />
    </section>
  );
}

export function BriefCard({ brief, context }) {
  const ready = brief.state === 'ready'
    && (Array.isArray(brief.points) ? Boolean(brief.headline && brief.points.length) : Boolean(brief.brief));
  const date = ready ? writtenDate(brief.writtenAt) : '';
  const waiting = brief.state === 'loading' || brief.state === 'writing' || brief.state === 'pending';
  return (
    <div className="rd-ai rp-brief" aria-live="polite">
      <div className="rd-sec-label">✦ Niyantran analysis{ready ? <small>{date ? ` · AI brief · written ${date}` : ' · AI brief'}</small> : null}</div>
      {ready && context ? <p className="desk-note">{context}</p> : null}
      {ready ? <BriefBody brief={brief} /> : waiting ? <BriefAnimation key={brief.record} writing={brief.state !== 'loading'} /> : (
        <div className="rd-ai-brief rp-brief-empty">{BRIEF_STATUS[brief.state] || BRIEF_STATUS.error}</div>
      )}
    </div>
  );
}

function Visual({ visual }) {
  const Component = visual && Object.hasOwn(VISUALS, visual.type) ? VISUALS[visual.type] : null;
  return Component ? <Component title={visual.title} right={visual.right} visual={visual} /> : null;
}

export default function RecordPanel({ model, onClose, onAsk, onSelect, onQuick, brief }) {
  if (!model) return null;
  if (isRecordBriefWaiting(brief)) return <RecordPaneLoading brief={brief} onClose={onClose} />;
  const { glance = {}, about = {}, touches, footer = {} } = model;
  const links = (model.links || []).map((l) => ({ ...l, href: safeHref(l.href) })).filter((l) => l.href);
  const tiles = glance.tiles || [];
  // F204 (owner 2026-10-16): no relations graph; the related records keep the section's number.
  const related = touches?.links?.length ? touches.links : [];
  const relatedLabel = `${String(touches?.label || '').match(/^\s*\d+\s*·\s*/)?.[0] || ''}Related on record`;
  const prov = footer.provenance || {};
  const quick = onQuick ? (model.quick || []) : [];
  const showBrief = Boolean(brief && brief.state !== 'none');
  return (
    <article className="rp" aria-label={`Record: ${model.title}`}>
      <header className="rp-head">
        <div className="rp-head-row">
          <h2 className="rp-title">{model.title}</h2>
          <button type="button" className="rp-close" aria-label="Close record" onClick={() => onClose?.()}>×</button>
        </div>
        <div className="rp-meta">
          {(model.meta || []).filter(Boolean).map((m, i) => <span key={i} className="rp-meta-item">{i ? <i aria-hidden="true">·</i> : null}{m}</span>)}
          {model.badge ? <span className={`rp-badge rp-${model.badge.tone || 'grey'}`}>{model.badge.text}</span> : null}
        </div>
        {links.length ? (
          <div className="rp-links">{links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">↗ {l.label}</a>)}</div>
        ) : null}
      </header>

      <section className="rp-block rp-first">
        <h3 className="rp-eyebrow">01 · At a glance</h3>
        {tiles.length ? (
          <div className="rp-tiles" style={{ '--rp-cols': Math.min(tiles.length, 4) }}>
            {tiles.map((t) => (
              <div key={t.label} className={`rp-tile${t.clock ? ' rp-clock' : ''}`}>
                <span className="rp-tile-l">{t.label}</span>
                <span className={`rp-tile-v${t.tone ? ` rp-${t.tone}-text` : ''}`}>{t.value}</span>
                {t.sub ? <span className="rp-tile-s">{t.sub}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        <Visual visual={glance.visual} />
        <Visual visual={glance.visual2} />
        {glance.callout ? <p className={`rp-callout rp-callout-${glance.callout.tone || 'amber'}`}><b aria-hidden="true">!</b><span>{glance.callout.text}</span></p> : null}
      </section>

      {about.rows?.length || about.chips?.length || about.cards?.length || showBrief ? (
        <section className="rp-block">
          <h3 className="rp-eyebrow">{about.label || '02 · About this record'}</h3>
          {showBrief ? <BriefCard brief={brief} context={model.briefContext} /> : null}
          {about.rows?.length ? (
            <dl className="rp-kv">{about.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          ) : null}
          {about.chips?.length ? <div className="rp-chips">{about.chips.map((c) => <span key={c}>{c}</span>)}</div> : null}
          {(about.cards || []).map((c) => (
            <div key={c.heading} className="rp-card"><div className="rp-card-hd">{c.heading}</div><p>{c.body}</p></div>
          ))}
        </section>
      ) : null}

      {quick.length ? (
        <section className="rp-block rp-quick">
          <div className="rp-blockhead"><h3 className="rp-eyebrow">Quick exit</h3><span>drafts the request in AI Research</span></div>
          <div className="rp-qrow">
            {quick.map((q) => <button key={q.label} type="button" className="rp-qbtn" onClick={() => onQuick(q.prompt)}>{q.label}</button>)}
          </div>
        </section>
      ) : null}

      {related.length ? (
        <section className="rp-block rp-touches">
          <h3 className="rp-eyebrow">{relatedLabel}</h3>
          <div className="rp-xlinks">
            {related.map((l) => (l.row && onSelect
              ? <button key={l.title} type="button" className="rp-xlink-open" onClick={() => onSelect(l.row)}><b>{l.title} →</b><span>{l.detail}</span></button>
              : l.to
                ? <a key={l.title} href={`/${deskHash(l.to.tab, l.to.feature)}`}><b>{l.title} →</b><span>{l.detail}</span></a>
                : <div key={l.title} className="rp-xlink-static"><b>{l.title}</b><span>{l.detail}</span></div>))}
          </div>
        </section>
      ) : null}

      <section className="rp-block rp-footer">
        <button type="button" className="rp-ask" onClick={() => onAsk?.()}>✦ {footer.ask || 'Ask AI about this record'}</button>
        <p className="rp-prov">
          <span><b>Source</b> {prov.source || 'Not on record'}</span>
          {prov.asOf ? <span><b>As of</b> {prov.asOf}</span> : null}
          {(prov.flags || []).map((f) => <span key={f} className="rp-flag">{f}</span>)}
          {(footer.health || []).map(([label, value]) => <span key={label} className="rp-health">{label} <b>{value}</b></span>)}
        </p>
        {footer.note ? <p className="rp-note">{footer.note}</p> : null}
      </section>
    </article>
  );
}
