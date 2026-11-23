// The desk card: nter.pro's record panel (website src/shell/record/RecordPanel.jsx) on the phone.
// Same markup, classes and stylesheet (src/shell/record/recordPanel.css, copied from the website),
// same NTER record animation while the AI brief is read or written, same model from the website's
// module adapters (src/shell/record/adapters) or, for modules without one, genericModel.js.
// What differs is only what the phone needs: related records and modules open in the app, Ask AI and
// Quick exit open the app's Ask AI, and a signed-out reader is offered sign-in in the brief box.
import { useEffect, useRef } from 'react';
import { loadRecordAnimation, RECORD_ANIMATION_LOGO } from '../shell/record/recordAnimation.js';
import { VISUALS } from '../shell/record/visuals/index.js';
import { RECORD_BRIEF_ANIMATION_MS } from './useDeskBrief.js';
import { asset } from '../lib/asset.js';
import '../shell/record/recordPanel.css';
import './deskCard.css';

const safeHref = (href) => (/^https:\/\//i.test(String(href || '')) ? href : null);

const BRIEF_STATUS = {
  unavailable: 'AI brief not available yet',
  error: 'AI brief unavailable right now',
};

function writtenDate(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function BriefBody({ brief }) {
  if (Array.isArray(brief.points)) {
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
      {brief.tags?.length ? <div className="rd-ai-tags">{brief.tags.map((t, i) => <span key={i} className="rd-ai-tag">{t}</span>)}</div> : null}
    </>
  );
}

/** The NTER record animation ("NTER is thinking"), the website's own web component, played for 2.5 s. */
function BriefAnimation({ writing }) {
  const host = useRef(null);
  useEffect(() => {
    let live = true;
    const el = host.current;
    loadRecordAnimation().then((ok) => {
      if (!ok || !live || typeof el?.load !== 'function') return;
      const waitForCancel = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      el.load(waitForCancel, () => document.createTextNode(''), { label: 'Opening the AI brief for this record.', duration: RECORD_BRIEF_ANIMATION_MS }).catch(() => {});
    });
    return () => { live = false; el?.cancel?.(); };
  }, []);
  return (
    <div className="rp-brief-anim">
      <nter-record-loader ref={host} logo-src={RECORD_ANIMATION_LOGO}>
        <div className="rp-brief-writing" role="status"><span className="rp-brief-mark"><img src={asset('/brand/logo-128.webp')} alt="" width="20" height="20" /></span><span>{writing ? 'Writing the AI brief…' : 'Loading the AI brief…'}</span></div>
        <div className="rp-brief-skel is-writing" aria-hidden="true"><i /><i /><i /></div>
      </nter-record-loader>
    </div>
  );
}

export const isRecordBriefWaiting = (brief) => ['loading', 'writing', 'pending'].includes(brief?.state);

/** While the brief settles, the animation fills the card. */
export function RecordPaneLoading({ brief, onClose }) {
  return (
    <section className="rp-record-loading dc-loading" aria-label="Niyantran analysis" aria-busy="true">
      {onClose ? <button type="button" className="rp-close rp-record-loading-close" onClick={onClose} aria-label="Close record">×</button> : null}
      <BriefAnimation key={brief.record} writing={brief.state !== 'loading'} />
    </section>
  );
}

export function BriefCard({ brief, onSignIn }) {
  const ready = brief.state === 'ready'
    && (Array.isArray(brief.points) ? Boolean(brief.headline && brief.points.length) : Boolean(brief.brief));
  const date = ready ? writtenDate(brief.writtenAt) : '';
  const waiting = isRecordBriefWaiting(brief);
  return (
    <div className="rd-ai rp-brief" aria-live="polite">
      <div className="rd-sec-label">✦ Niyantran analysis{ready ? <small>{date ? ` · AI brief · written ${date}` : ' · AI brief'}{brief.sample ? ' · sample' : ''}</small> : null}</div>
      {ready ? <BriefBody brief={brief} /> : waiting ? <BriefAnimation key={brief.record} writing={brief.state !== 'loading'} /> : brief.state === 'guest' ? (
        <div className="rd-ai-brief rp-brief-empty">
          Sign in to read the AI brief nter.pro keeps for this record.
          {onSignIn ? <button type="button" className="dc-signin" onClick={onSignIn}>Sign in</button> : null}
        </div>
      ) : (
        <div className="rd-ai-brief rp-brief-empty">{BRIEF_STATUS[brief.state] || BRIEF_STATUS.error}</div>
      )}
    </div>
  );
}

function Visual({ visual }) {
  const Component = visual && Object.hasOwn(VISUALS, visual.type) ? VISUALS[visual.type] : null;
  return Component ? <Component title={visual.title} right={visual.right} visual={visual} /> : null;
}

/**
 * model: RecordPanelModel. brief: useDeskBrief state. onSelect(row) opens a related record,
 * onOpenModule({tab, feature}) a related module, onAsk() / onQuick(prompt) Ask AI with the record,
 * onOpenLink(href) a source link in the system browser.
 */
export default function DeskCard({ model, brief, dark, onClose, onAsk, onSelect, onQuick, onOpenModule, onOpenLink, onSignIn }) {
  if (!model) return null;
  const theme = `dc${dark ? ' theme-dark' : ''}`;
  if (isRecordBriefWaiting(brief)) return <div className={theme}><RecordPaneLoading brief={brief} onClose={onClose} /></div>;
  const { glance = {}, about = {}, touches, footer = {} } = model;
  const links = (model.links || []).map((l) => ({ ...l, href: safeHref(l.href) })).filter((l) => l.href);
  const tiles = glance.tiles || [];
  const related = touches?.links?.length ? touches.links : [];
  const relatedLabel = `${String(touches?.label || '').match(/^\s*\d+\s*·\s*/)?.[0] || ''}Related on record`;
  const prov = footer.provenance || {};
  const quick = onQuick ? (model.quick || []) : [];
  const showBrief = Boolean(brief && brief.state !== 'none');
  return (
    <div className={theme}>
      <article className="rp" aria-label={`Record: ${model.title}`}>
        <header className="rp-head">
          <div className="rp-head-row">
            <h2 className="rp-title">{model.title}</h2>
            {onClose ? <button type="button" className="rp-close" aria-label="Close record" onClick={() => onClose()}>×</button> : null}
          </div>
          <div className="rp-meta">
            {(model.meta || []).filter(Boolean).map((m, i) => <span key={i} className="rp-meta-item">{i ? <i aria-hidden="true">·</i> : null}{m}</span>)}
            {model.badge ? <span className={`rp-badge rp-${model.badge.tone || 'grey'}`}>{model.badge.text}</span> : null}
          </div>
          {links.length ? (
            <div className="rp-links">{links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" onClick={onOpenLink ? (e) => { e.preventDefault(); onOpenLink(l.href); } : undefined}>↗ {l.label}</a>)}</div>
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
            {showBrief ? <BriefCard brief={brief} onSignIn={onSignIn} /> : null}
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
            <div className="rp-blockhead"><h3 className="rp-eyebrow">Quick exit</h3><span>drafts the request in Ask AI</span></div>
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
                : l.to && onOpenModule
                  ? <button key={l.title} type="button" className="rp-xlink-open" onClick={() => onOpenModule(l.to)}><b>{l.title} →</b><span>{l.detail}</span></button>
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
    </div>
  );
}
