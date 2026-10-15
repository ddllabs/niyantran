import { analysisFor, buildRecordModel, DESKS } from '../../../lib/impactRecord.js';
import { cap, dateLabel, plural, presentRows, sourceLinks } from './common.js';
import { titleCaseCaps } from './feedText.js';

/**
 * Bill Passage Probability Index → record panel (F124). Rows are the Sansad bills register; the
 * analysis pack (ctx.packs, loaded by the panel host) adds the passage figure, precedent, time in
 * stage and the authored brief for the bills it covers. The register holds no date for any
 * stage after introduction, and for a resolved bill the stored passage figure is simply its outcome,
 * so the panel shows a passage figure only for a pending bill, as the historical base rate it is.
 */
const STAGES = {
  assented: { badge: 'Law (assented)', tone: 'green' },
  passed: { badge: 'Passed', tone: 'blue' },
  pending: { badge: 'Pending', tone: 'amber' },
  lapsed: { badge: 'Lapsed', tone: 'grey', end: true },
  withdrawn: { badge: 'Withdrawn', tone: 'grey', end: true },
  negatived: { badge: 'Negatived', tone: 'red', end: true },
  removed: { badge: 'Removed', tone: 'grey', end: true },
};
const PATH = ['Introduced', 'Pending in Parliament', 'Passed', 'Assented'];
const MAX_RELATED = 3;

// Register names print as written; only an all-capitals name is title-cased (feedText.js, F127).
const titleCase = titleCaseCaps;
const stageKey = (s) => String(s || '').trim().toLowerCase();
const httpsOnly = (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');

function stageTimeline(stage, introduced, daysInStage) {
  const key = stageKey(stage);
  const info = STAGES[key];
  if (!info) return undefined;
  const detail = daysInStage != null ? `${plural(daysInStage, 'day')} in this stage (register analysis)` : undefined;
  if (info.end) {
    return [
      { label: 'Introduced', detail: introduced || undefined, done: true },
      { label: info.badge, detail, now: true },
    ];
  }
  const at = key === 'pending' ? 1 : key === 'passed' ? 2 : 3;
  return PATH.map((label, i) => ({
    label,
    detail: i === 0 ? introduced || undefined : i === at ? detail : undefined,
    done: i < at,
    now: i === at,
  }));
}

export default function nationalBills(row, ctx = {}) {
  const packs = ctx.packs?.ready ? ctx.packs : null;
  const a = packs ? analysisFor(row, packs.analysis) : null;
  const impact = packs ? buildRecordModel(row, a, packs.ontology, DESKS.bill) : null;
  const title = titleCase(row.bill_name || row.title) || 'Bill';
  const stage = String(row.current_stage || '').trim();
  const info = STAGES[stageKey(stage)];
  const introduced = dateLabel(row.date_introduced);
  const asOf = dateLabel(row.as_of);
  const ministry = titleCase(row.sector);
  const pp = a?.passage_probability || {};
  // A passage figure is shown only for a pending bill whose pack note says it is a base rate; for any
  // other bill (including the 369 with no stage on record) the stored figure may be its outcome.
  const isBaseRate = stageKey(stage) === 'pending' && /^base rate/i.test(String(pp.methodology_note || '').trim());
  const baseRate = isBaseRate && pp.score != null && Number.isFinite(Number(pp.score)) ? Math.round(Number(pp.score)) : null;
  const precedent = a?.precedent?.similar_bill_count ? a.precedent : null;
  const days = a?.stage_duration?.days_in_current_stage;
  const daysInStage = days != null && Number.isFinite(Number(days)) ? Number(days) : null;
  const typical = a?.stage_duration?.typical_days_for_stage;
  const pdf = httpsOnly(impact?.pdf);

  const rows = ctx.rows || [];
  const related = row.sector
    ? rows.filter((r) => r !== row && r.id !== row.id && r.sector === row.sector)
      .sort((x, y) => String(y.date_introduced || '').localeCompare(String(x.date_introduced || '')))
    : [];

  return {
    title,
    meta: [row.house, row.bill_type?.trim() ? `${row.bill_type.trim()} bill` : '', row.bill_category?.trim()].filter(Boolean),
    badge: info ? { text: info.badge, tone: info.tone } : undefined,
    links: [...(pdf ? [{ label: 'Bill text (PDF)', href: pdf }] : []), ...sourceLinks(row, 'Source on Sansad')],
    glance: {
      tiles: [
        { label: 'Stage', value: stage || 'Not on record', sub: asOf ? `register as of ${asOf}` : 'current stage', tone: info && info.tone !== 'grey' ? info.tone : undefined },
        { label: 'Introduced', value: introduced || 'Not on record', sub: row.house || undefined },
        ...(baseRate != null ? [{ label: 'Passage (base rate)', value: `${baseRate}%`, sub: 'historical base rate, not a forecast' }] : []),
        ...(precedent && baseRate == null ? [{ label: 'Precedent', value: `${precedent.similar_bill_passed_count} of ${precedent.similar_bill_count}`, sub: 'similar resolved bills passed' }] : []),
        ...(daysInStage != null ? [{ label: 'Days in stage', value: String(daysInStage), sub: typical != null ? `typical ~${typical} days` : 'register analysis' }] : []),
      ].slice(0, 4),
      visual: info ? {
        type: 'timeline',
        title: 'Stage history',
        right: asOf ? `as of ${asOf}` : undefined,
        steps: stageTimeline(stage, introduced, daysInStage),
        caption: 'Only the introduction is dated; the register records the current stage, not the date of each step.',
      } : undefined,
    },
    about: {
      label: '02 · About this bill',
      rows: presentRows([
        ['Bill number', row.bill_number],
        ['House', row.house],
        ['Type', row.bill_type?.trim()],
        ['Category', row.bill_category?.trim()],
        ['Ministry on record', ministry],
        ['Register as of', asOf],
      ]),
      chips: (a?.key_terms || []).slice(0, 10),
      cards: [
        ...(a?.brief ? [{ heading: 'Summary (register analysis)', body: String(a.brief) }] : []),
        ...(Array.isArray(a?.key_changes) && a.key_changes.length ? [{ heading: 'Key changes (register analysis)', body: a.key_changes.map(String).join(' · ') }] : []),
        ...(baseRate != null && pp.methodology_note ? [{ heading: 'How the base rate is read', body: String(pp.methodology_note) }] : []),
        ...(precedent?.base_rate_label ? [{ heading: 'Precedent', body: `${cap(precedent.base_rate_label)}. What usually happened to similar bills, not a forecast for this one.` }] : []),
      ],
    },
    touches: {
      label: '03 · Bill & its impact',
      links: [
        ...related.slice(0, MAX_RELATED).map((r) => ({ title: titleCase(r.bill_name || r.title), detail: [r.current_stage, dateLabel(r.date_introduced)].filter(Boolean).join(' · '), row: r })),
        ...(related.length > MAX_RELATED ? [{ title: `Other ${ministry} bills`, detail: `${related.length} on the register` }] : []),
      ],
    },
    footer: {
      ask: 'Ask AI about this bill',
      provenance: { source: 'Sansad bills register (sansad.in)', asOf, flags: asOf ? [] : ['as-of not on record'] },
      note: 'A passage figure appears only for a pending bill, as the historical base rate of similar bills: not a forecast. A resolved bill shows its outcome as its stage.',
    },
  };
}
