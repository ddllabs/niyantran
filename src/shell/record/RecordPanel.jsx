import { deskHash } from '../../lib/deskRoute.js';
import { VISUALS } from './visuals/index.js';
import TouchGraph from './visuals/TouchGraph.jsx';
import './recordPanel.css';

/**
 * One record panel for every Global module (F121; docs/specs/2026-10-13-global-record-panels.md).
 * It renders a RecordPanelModel built by a module adapter: header, 01 at a glance, 02 about,
 * 03 what it touches, and a footer that names the provider and as-of date. A part the model lacks
 * is omitted; the panel never shows a placeholder or claims a live feed it is not.
 */

const safeHref = (href) => (/^https:\/\//i.test(String(href || '')) ? href : null);

/**
 * The saved AI brief box (F123; owner 2026-10-13: keep it until AI credits). It shows a brief only
 * when one was saved earlier from AI Research, says so plainly when none was, and never fills the
 * box with template text. `brief` is { busy, lines, err } from useEntryBrief; absent means no box.
 */
function BriefCard({ brief }) {
  const lines = brief.lines || [];
  const body = brief.busy && !lines.length
    ? 'Checking for a saved AI brief…'
    : lines.length
      ? null
      : brief.err
        ? 'Saved AI brief unavailable right now.'
        : 'No saved AI brief for this record yet. Use Ask AI below to research it.';
  return (
    <div className="rp-card rp-brief">
      <div className="rp-card-hd">✦ Niyantran analysis{lines.length ? <small>Saved AI brief</small> : null}</div>
      {lines.length ? lines.map((l) => <p key={l}>{l}</p>) : <p className="rp-brief-empty">{body}</p>}
    </div>
  );
}

function Visual({ visual }) {
  const Component = visual && Object.hasOwn(VISUALS, visual.type) ? VISUALS[visual.type] : null;
  return Component ? <Component title={visual.title} right={visual.right} visual={visual} /> : null;
}

export default function RecordPanel({ model, onClose, onAsk, onSelect, onQuick, brief }) {
  if (!model) return null;
  const { glance = {}, about = {}, touches, footer = {} } = model;
  const links = (model.links || []).map((l) => ({ ...l, href: safeHref(l.href) })).filter((l) => l.href);
  const tiles = glance.tiles || [];
  const nodeCount = touches ? ['left', 'center', 'right', 'far'].filter((k) => touches.nodes?.[k]).length : 0;
  const prov = footer.provenance || {};
  const quick = onQuick ? (model.quick || []) : [];
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

      {about.rows?.length || about.chips?.length || about.cards?.length || brief ? (
        <section className="rp-block">
          <h3 className="rp-eyebrow">{about.label || '02 · About this record'}</h3>
          {brief ? <BriefCard brief={brief} /> : null}
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

      {touches ? (
        <section className="rp-block rp-touches">
          <div className="rp-blockhead"><h3 className="rp-eyebrow">{touches.label}</h3><span>{nodeCount} nodes on record</span></div>
          <TouchGraph lanes={touches.lanes} nodes={touches.nodes} />
          <p className="rp-viz-cap">Relations on record, computed from the registers; not an assessed impact.</p>
          {touches.links?.length ? (
            <div className="rp-xlinks">
              {touches.links.map((l) => (l.row && onSelect
                ? <button key={l.title} type="button" className="rp-xlink-open" onClick={() => onSelect(l.row)}><b>{l.title} →</b><span>{l.detail}</span></button>
                : l.to
                  ? <a key={l.title} href={`/${deskHash(l.to.tab, l.to.feature)}`}><b>{l.title} →</b><span>{l.detail}</span></a>
                  : <div key={l.title} className="rp-xlink-static"><b>{l.title}</b><span>{l.detail}</span></div>))}
            </div>
          ) : null}
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
