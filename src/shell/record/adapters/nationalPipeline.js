import { analysisFor } from '../../../lib/impactRecord.js';
import { dateLabel, plural, presentRows } from './common.js';

/**
 * Policy Pipeline Tracker → record panel (F124). The module serves two kinds of row
 * (server/nationalFeed.mjs, Policy Pipeline branch):
 *  - live: generic PIB press releases, stage "PIB release", with a title, date and link but no
 *    ministry. They are press releases, not draft-to-gazette stages, and are never badged as one;
 *  - embedded fallback: eight press-reported policy items (policy_name, ministry, stage, source
 *    headline, date_reported). Their source_url is always a Google News link, which is never shown.
 * The analysis pack joins only the embedded items, by the id the server assigns. Nothing here
 * calls a model or the network: the panel reads what the row and the loaded packs hold.
 */
const MAX_RELATED = 3;
const NO_STAGE = 'Stage not on record';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => clean(v).toLowerCase();
/** An https link that is not a Google News redirect (those are never opened or shown). */
const usableLink = (u) => (/^https:\/\//i.test(String(u || '')) && !/news\.google\./i.test(String(u)) ? String(u) : '');
const isPress = (row) => /\bpib\b|press release/i.test(clean(row.stage)) || (!clean(row.policy_name) && /press information bureau/i.test(clean(row.source)));
/** Google News headlines read "Headline - Outlet"; the outlet is the part after the last " - ". */
function outletOf(row) {
  const s = clean(row.source_title);
  const i = s.lastIndexOf(' - ');
  const tail = i > 0 ? s.slice(i + 3).trim() : '';
  return tail.length >= 2 && tail.length <= 60 ? tail : '';
}
const dateOf = (row) => dateLabel(row.date_reported) || dateLabel(row.date);
const text = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean).join(' · ') : clean(v));

function stageTone(stage) {
  if (/pending|awaiting/i.test(stage)) return 'amber';
  if (/gazett|notified|in force/i.test(stage)) return 'green';
  return 'blue';
}

/** The stage values across the rows on hand, with counts; this row's stage is marked in its note. */
function stageBoard(row, rows, press, tone) {
  const mine = key(row.stage) || NO_STAGE.toLowerCase();
  const counts = new Map();
  const add = (r) => {
    const k = key(r.stage) || NO_STAGE.toLowerCase();
    const hit = counts.get(k);
    if (hit) hit.n += 1;
    else counts.set(k, { label: clean(r.stage) || NO_STAGE, n: 1 });
  };
  rows.forEach(add);
  if (!counts.has(mine)) add(row);
  const entries = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const total = entries.reduce((sum, [, e]) => sum + e.n, 0);
  return {
    type: 'board',
    title: 'What the stage column contains',
    right: `${plural(total, 'item')} on hand`,
    rows: entries.map(([k, e]) => ({
      label: e.label,
      value: plural(e.n, 'item'),
      note: k === mine ? (press ? 'this release' : 'this policy') : undefined,
      tone: k === mine ? tone : undefined,
    })),
    caption: press
      ? 'These are press releases from the PIB feed, not draft-to-gazette stages. The feed carries no stage for a release.'
      : 'Stages as reported in the press, not confirmed against the Gazette of India. The register does not date each step.',
  };
}

export default function nationalPipeline(row, ctx = {}) {
  const packs = ctx.packs?.ready ? ctx.packs : null;
  const press = isPress(row);
  // The pack is keyed by the id the server gives the embedded items; a press release never joins it.
  const a = packs && !press ? analysisFor(row, packs.analysis) : null;

  const title = clean(press ? row.title || row.topic : row.policy_name || row.title) || (press ? 'PIB press release' : 'Policy item');
  const stage = clean(row.stage);
  const ministry = clean(row.ministry);
  const date = dateOf(row);
  const source = press ? clean(row.source) || 'Press Information Bureau' : outletOf(row);
  const badge = press ? { text: 'Press release', tone: 'grey' } : stage ? { text: stage, tone: stageTone(stage) } : undefined;
  const noun = press ? 'release' : 'policy';

  const sameMinistry = ministry ? key(ministry) : '';
  const related = sameMinistry
    ? (ctx.rows || [])
      .filter((r) => r && r !== row && !(r.id != null && row.id != null && String(r.id) === String(row.id)) && key(r.ministry) === sameMinistry)
      .sort((x, y) => String(y.date_reported || y.date || '').localeCompare(String(x.date_reported || x.date || '')))
    : [];

  const tiles = [
    { label: 'Stage', value: stage || 'Not on record', sub: press ? 'a press release, not a pipeline stage' : 'as reported in the press', tone: press ? undefined : badge?.tone },
    ...(date ? [{ label: press ? 'Released' : 'Reported', value: date }] : []),
    ...(ministry ? [{ label: 'Ministry', value: ministry }] : []),
  ];
  if (tiles.length < 2) tiles.push({ label: 'Source', value: source || 'Not on record' });

  const link = usableLink(row.source_url);

  return {
    title,
    meta: press ? [source] : [ministry, source].filter(Boolean),
    badge,
    links: link ? [{ label: press ? 'Release on PIB' : 'Source article', href: link }] : [],
    glance: {
      tiles: tiles.slice(0, 4),
      visual: stageBoard(row, (ctx.rows || []).filter((r) => r && typeof r === 'object'), press, badge?.tone),
    },
    about: {
      label: `02 · About this ${noun}`,
      rows: presentRows([
        ['Ministry', ministry],
        ['Stage', stage],
        [press ? 'Released' : 'Reported', date],
        ...(press ? [['Source', source]] : [['Source headline', clean(row.source_title)]]),
      ]),
      chips: Array.isArray(a?.tags) ? a.tags.map(clean).filter(Boolean).slice(0, 10) : [],
      cards: [
        ...(text(a?.brief) ? [{ heading: 'Summary (register analysis)', body: text(a.brief) }] : []),
        ...(text(a?.why_it_matters) ? [{ heading: 'Why it matters (register analysis)', body: text(a.why_it_matters) }] : []),
        ...(text(a?.watch_for) ? [{ heading: 'What to watch for (register analysis)', body: text(a.watch_for) }] : []),
      ],
    },
    touches: {
      label: `03 · ${press ? 'Release' : 'Policy'} & its reach`,
      links: [
        ...related.slice(0, MAX_RELATED).map((r) => ({
          title: clean(r.policy_name || r.title) || 'Policy item',
          detail: [clean(r.stage), dateOf(r)].filter(Boolean).join(' · '),
          row: r,
        })),
        ...(related.length > MAX_RELATED ? [{ title: `Other ${ministry} items`, detail: `${related.length} on the register` }] : []),
      ],
    },
    footer: {
      ask: `Ask AI about this ${noun}`,
      provenance: {
        source: press ? 'PIB press release feed (pib.gov.in)' : 'Policy pipeline register (items reported in the press)',
        asOf: date || undefined,
        flags: date ? [] : ['as-of not on record'],
      },
      note: press
        ? 'A PIB press release is not a stage in the draft-to-gazette pipeline: the feed carries no stages. This feed is shared with Cabinet Decisions.'
        : 'Stages are as reported in the press and are not confirmed against the Gazette of India. This register is the latest stored set shown while the PIB feed is unavailable; the live PIB feed carries press releases, not pipeline stages, and is shared with Cabinet Decisions.',
    },
  };
}
