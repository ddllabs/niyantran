import { useWorkspaceState } from '../shell/workspaceState.js';
import { useEffect, useMemo } from 'react';
import {
  markerPos,
  ordered,
  regionGroup,
  statsFor,
  statusOf,
  theatresFromFeed,
} from '../lib/conflictsMonitor.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop, { choiceGroup, matchesChoice } from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { openAiResearch, rowDragProps } from '../lib/aiDrop.js';
import { downloadJson, withExportProvenance } from '../lib/exportProvenance.js';
import CorpusCapability from '../shell/CorpusCapability.jsx';

function developmentParts(t) {
  const headline = String(t?.headline || '').trim();
  const hook = String(t?.hook || '').trim();
  if (headline && hook) return { headline, hook, sev: t?.sev || 'medium' };
  const raw = String(t?.text || '').trim();
  if (!raw) return { headline: 'Update', hook: '', sev: t?.sev || 'medium' };
  const bits = raw.split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);
  if (bits.length >= 2) {
    const lead = bits[0].replace(/\.$/, '');
    const rest = bits.slice(1).join(' ');
    return {
      headline: lead,
      hook: `${lead}. ${rest}${/[.!?]$/.test(rest) ? '' : '.'}`,
      sev: t?.sev || 'medium',
    };
  }
  return { headline: raw.replace(/\.$/, ''), hook: raw.endsWith('.') ? raw : `${raw}.`, sev: t?.sev || 'medium' };
}

function theatrePrompt(c, angle = 0) {
  const actors = (c.actors || []).slice(0, 4).join(', ') || 'the named actors';
  const posture = statusOf(c.status).label.toLowerCase();
  const prompts = [
    `Build a dated briefing for ${c.name}. Separate verified developments from actor claims, explain the current ${posture} posture, and cite the attached sources for each key point.`,
    `Map the actors and interests in ${c.name}, including ${actors}. Identify what changed most recently, what remains disputed, and which source would best resolve each gap.`,
    `Compare the latest ${c.name} development with the earlier record in this dossier. Highlight escalation or de-escalation indicators without predicting an outcome.`,
    `Prepare a source-critical note on ${c.name} in ${regionGroup(c.region)}. Reconcile conflicting figures, preserve each source's date and scope, and list the questions the dossier cannot answer.`,
  ];
  const seed = String(c.id || c.name).split('').reduce((n, ch) => n + ch.charCodeAt(0), 0);
  return prompts[(seed + angle) % prompts.length];
}

export default function ConflictsMonitor({ workspaceScope = '', feed, selected, onSelect, vizFilter, onClearViz }) {
  const theatres = useMemo(() => theatresFromFeed(feed), [feed]);
  const [region, setRegion] = useWorkspaceState('ConflictsMonitor.region', 'Global', workspaceScope);
  const [posture, setPosture] = useWorkspaceState('ConflictsMonitor.posture', 'All', workspaceScope);
  const [query, setQuery] = useWorkspaceState('ConflictsMonitor.query', '', workspaceScope);

  const regions = useMemo(() => {
    const set = new Set(theatres.map((c) => regionGroup(c.region)));
    return ['Global', ...[...set].sort()];
  }, [theatres]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    return theatres.filter((c) => {
      if (!matchesChoice(region, regionGroup(c.region), 'Global')) return false;
      if (!matchesChoice(posture, c.status, 'All')) return false;
      if (!applyVizFilter(c.row || c, vizFilter)) return false;
      if (!q) return true;
      return [c.name, c.region, c.status, c.latest, ...(c.actors || [])].join(' ').toLowerCase().includes(q);
    });
  }, [theatres, region, posture, query, vizFilter]);

  const ranked = useMemo(() => ordered(view), [view]);
  const stats = useMemo(() => statsFor(theatres), [theatres]);
  const selectedId = selected?.id || ranked[0]?.id || '';
  const current = theatres.find((c) => c.id === selectedId) || ranked[0] || null;
  const st = current ? statusOf(current.status) : null;
  const asOf = feed?.meta?.asOf || feed?.coverage?.through || '';
  const timeline = (feed?.timeline || []).slice(0, 5);

  useEffect(() => {
    if (!ranked.length) return;
    if (selected && ranked.some((c) => c.id === selected.id)) return;
    onSelect?.(ranked[0].row);
  }, [ranked, selected, onSelect]);

  function pick(id) {
    const hit = theatres.find((c) => c.id === id);
    if (hit) onSelect?.(hit.row);
  }

  function exportRegister() {
    const conflicts = withExportProvenance(
      theatres.map(({ row, ...rest }) => ({ ...rest, ...(row || {}) })),
      {
        feature: feed?.feature || 'Conflicts',
        filterNote: [region !== 'Global' ? `region=${region}` : '', posture !== 'All' ? `posture=${posture}` : '', query.trim() ? `q=${query.trim()}` : '']
          .filter(Boolean)
          .join('; '),
      },
    );
    downloadJson('niyantran-conflicts-register.json', { asOf, derived: stats, conflicts });
  }

  if (!theatres.length) {
    return <div className="c2-empty">Conflict records are unavailable.</div>;
  }

  return (
    <div className="c2">
      <header className="c2-head">
        <div className="c2-identity">
          <b>Global monitor</b>
          <span>AS OF {asOf}</span>
        </div>
        <div className="c2-strip">
          <span>
            <b>{stats.tracked}</b>theatres
          </span>
          <span className="hot">
            <b>{stats.deteriorating}</b>deteriorating
          </span>
          <span className="cease">
            <b>{stats.ceasefires}</b>fragile ceasefires
          </span>
          <span>
            <b>{stats.sourceLinked}</b>source-linked
          </span>
        </div>
        <div className="c2-actions">
          <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
          <TableFilterPop
            q={query}
            onQ={setQuery}
            searchPlaceholder="Search theatre, actor or region"
            vizFilter={vizFilter}
            onClearViz={onClearViz}
            extraGroups={[
              choiceGroup('Region', regions.filter((r) => r !== 'Global'), region, setRegion, { allValue: 'Global', allLabel: 'Global' }),
              choiceGroup(
                'Posture',
                [
                  { value: 'escalating', label: 'Deteriorating' },
                  { value: 'active', label: 'Active hostilities' },
                  { value: 'ceasefire-fragile', label: 'Fragile ceasefire' },
                  { value: 'under-review', label: 'Monitored' },
                ],
                posture,
                setPosture,
                { allValue: 'All', allLabel: 'All postures' },
              ),
            ]}
          />
          <button type="button" className="c2-action" onClick={exportRegister}>
            Export
          </button>
        </div>
      </header>

      <section className="c2-main">
        <div className="c2-map">
          <div className="c2-map-title">Theatre map</div>
          <div className="c2-map-asof">{view.length} shown · click a marker</div>
          <div className="c2-markers">
            {view.map((c) => {
              const pos = markerPos(c);
              const s = statusOf(c.status);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`c2-marker${c.id === selectedId ? ' on' : ''}`}
                  style={{ left: pos.left, top: pos.top, background: s.color }}
                  aria-label={`${c.name}, ${s.label}`}
                  onClick={() => pick(c.id)}
                >
                  <span>
                    {c.name}
                    <em>
                      {s.label} · {regionGroup(c.region)}
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="c2-map-footer">
            <span>
              <i style={{ background: '#ce3f34' }} />
              Deteriorating
            </span>
            <span>
              <i style={{ background: '#d97932' }} />
              Active
            </span>
            <span>
              <i style={{ background: '#a86e17' }} />
              Ceasefire
            </span>
            <span>
              <i style={{ background: '#2f6eaa' }} />
              Monitored
            </span>
            <span className="hint">Boundaries for orientation only</span>
          </div>
        </div>

        <aside className="c2-side">
          <div className="c2-selected">
            {current ? (
              <>
                <div className="c2-dossier-kicker">Selected theatre</div>
                <div className="c2-selected-top">
                  <h2>{current.name}</h2>
                  <span className="c2-posture" style={{ '--c2-posture': st.color, color: st.color }}>
                    {st.label}
                  </span>
                </div>
                <div className="c2-subline">
                  <span>{regionGroup(current.region)}</span>
                  {current.since ? <span>Since {current.since}</span> : null}
                  {current.intensity ? <span>{current.intensity} intensity</span> : null}
                </div>

                {(current.fatalitiesEst || current.displaced) && (
                  <div className="c2-facts">
                    {current.fatalitiesEst ? (
                      <div className="c2-fact">
                        <label>Reported casualties</label>
                        <strong title={current.fatalitiesEst}>{current.fatalitiesEst}</strong>
                      </div>
                    ) : null}
                    {current.displaced ? (
                      <div className="c2-fact">
                        <label>Displacement</label>
                        <strong title={current.displaced}>{current.displaced}</strong>
                      </div>
                    ) : null}
                  </div>
                )}

                {current.latest ? (
                  <div className="c2-latest">
                    <label>Latest development</label>
                    <p>{current.latest}</p>
                  </div>
                ) : null}

                {current.actors.length > 0 && (
                  <div className="c2-actors">
                    <label>Actors</label>
                    <div className="c2-actor-list">
                      {current.actors.slice(0, 6).map((a) => (
                        <span key={a}>{a}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="c2-evidence">
                  <label>Sources</label>
                  <div className="c2-source-list">
                    {current.sources.length ? (
                      current.sources.slice(0, 4).map((s) => (
                        <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
                          {s.label}
                        </a>
                      ))
                    ) : (
                      <span className="c2-source-empty">No linked sources on this record</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="c2-ai-btn"
                    onClick={() => openAiResearch({ row: current.row, prompt: theatrePrompt(current, 1) })}
                  >
                    Ask about this theatre
                  </button>
                </div>
              </>
            ) : (
              <div className="c2-empty">No theatre matches the current filters.</div>
            )}
          </div>

          <div className="c2-side-head">
            <b>Attention queue</b>
            <span>By posture</span>
          </div>
          <div className="c2-queue">
            {ranked.length === 0 ? (
              <div className="c2-empty">No matching theatres.</div>
            ) : (
              ranked.slice(0, 8).map((c) => {
                const s = statusOf(c.status);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`c2-q${c.id === selectedId ? ' on' : ''}`}
                    onClick={() => pick(c.id)}
                    {...rowDragProps(c.row, { title: c.name, feature: feed?.feature })}
                  >
                    <i style={{ background: s.color }} />
                    <span>
                      <b>{c.name}</b><CorpusCapability row={c.row} feed={feed} />
                      <small>
                        {regionGroup(c.region)}
                        {c.since ? ` · ${c.since}` : ''}
                      </small>
                    </span>
                    <em>{s.short}</em>
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </section>

      <section className="c2-tape">
        <div className="c2-tape-label">
          <b>Latest developments</b>
          <span>What moved across theatres in the last recorded window.</span>
        </div>
        {timeline.map((t) => {
          const { headline, hook, sev } = developmentParts(t);
          return (
            <article key={`${t.date}-${t.region}`} className={`c2-event sev-${sev}`}>
              <time>
                {t.date} · {t.region}
              </time>
              <b>{headline}</b>
              <p>{hook}</p>
            </article>
          );
        })}
      </section>

      <section className="c2-register">
        <div className="c2-reg-head">
          <b>Theatre register</b>
          <span>{view.length} records</span>
          <span className="note">Drag a theatre onto AI research · click to inspect</span>
        </div>
        <div className="c2-tablewrap">
          {ranked.length === 0 ? (
            <div className="c2-empty">No matching records.</div>
          ) : (
            <table className="c2-table">
              <colgroup>
                <col style={{ width: '10%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col />
                <col style={{ width: '13%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Posture</th>
                  <th>Theatre</th>
                  <th>Region</th>
                  <th>Since</th>
                  <th>Reported casualties</th>
                  <th>Displacement</th>
                  <th>Latest</th>
                  <th>AI analysis</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((c) => {
                  const s = statusOf(c.status);
                  return (
                    <tr
                      key={c.id}
                      className={c.id === selectedId ? 'on' : ''}
                      onClick={() => pick(c.id)}
                      {...rowDragProps(c.row, { title: c.name, feature: feed?.feature })}
                    >
                      <td>
                        <span className="c2-state">
                          <i style={{ background: s.color }} />
                          {s.short}
                        </span>
                      </td>
                      <td className="theatre">
                        <span>{c.name}</span><CorpusCapability row={c.row} feed={feed} />
                      </td>
                      <td>{regionGroup(c.region)}</td>
                      <td>{c.since}</td>
                      <td title={c.fatalitiesEst}>{c.fatalitiesEst || 'Not reported'}</td>
                      <td title={c.displaced}>{c.displaced || 'Not reported'}</td>
                      <td title={c.latest}>{c.latest}</td>
                      <td className="c2-ai-cell">
                        <button
                          type="button"
                          className="c2-ai-request"
                          onClick={(e) => {
                            e.stopPropagation();
                            openAiResearch({
                              row: c.row,
                              prompt: theatrePrompt(c),
                            });
                          }}
                        >
                          Ask AI
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
      <footer className="c2-foot">
        <span>Reported figures keep each dossier’s original scope and time period.</span>
        <span>
          {stats.regions} normalized regions · {stats.sourceLinked} evidence-linked records
        </span>
      </footer>
    </div>
  );
}
