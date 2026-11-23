import { bindingType, hydrateAlliance, memberRecords, memberSummary, overlaps } from '../../../lib/alliances.js';
import { countryPosition } from '../geoLookup.js';
import { cap, dateLabel, plural, presentRows, sourceLinks } from './common.js';

/**
 * Alliances (the embedded alliance and bloc register) → record panel (F121). The rows come through
 * flattenAlliance (src/lib/alliances.js): a roster, a seat, a legal basis, milestones as a flat
 * [date, text, date, text...] list and a verified date. They hold no coordinates, no Open Fronts
 * links and no pending applications, so the panel shows none of those. Member positions are country
 * centres. Roster standing (exception, review, transition, differentiated) is the register's own
 * member flags, which the feed carries in `meta.memberFlags`; without them no standing is claimed.
 */
const NOT_ON_RECORD = 'Not on record';
const TONE_OF_STANDING = { aligned: 'blue', differentiated: 'amber', transition: 'green', exception: 'red', review: 'red' };
const LEGEND = { amber: 'differentiated participation', green: 'accession transition or restored participation', red: 'formal exception, withdrawal or status review' };
/** The library's fallback when a legal basis names no treaty, charter or agreement; not a finding. */
const BINDING_FALLBACK = 'Not stated';

const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

/** "22 Aug 2026" as written, an ISO date or month as a label; '' when it is not a date. */
function asOfLabel(value) {
  const s = text(value);
  if (/^\d{1,2} [A-Za-z]{3} \d{4}$/.test(s)) return s;
  return dateLabel(s);
}

/** The status split into a badge and any qualifier: "Active; Armenia participation frozen" → Active, amber. */
function statusOf(status) {
  const s = text(status);
  if (!s) return null;
  const head = cap(s.split(';')[0].trim());
  if (!head) return null;
  if (s.includes(';')) return { badge: { text: head, tone: 'amber' }, qualified: s };
  return { badge: { text: head, tone: /^active$/i.test(head) ? 'green' : 'grey' }, qualified: '' };
}

/** The roster member whose country centre is the seat's country ("Brussels, Belgium" → Belgium); '' when the seat names no member. */
function seatMember(seat, memberNames) {
  const parts = text(seat).split(',');
  if (parts.length < 2) return '';
  const where = countryPosition(parts[parts.length - 1]);
  if (!where) return '';
  return memberNames.find((m) => {
    const at = countryPosition(m);
    return at && at.lat === where.lat && at.lon === where.lon;
  }) || '';
}

/** The milestones as steps: the list is [date, text, ...], so an unpaired tail cannot be read and is dropped. */
function milestoneSteps(list) {
  const pairs = [];
  for (let i = 0; i + 1 < list.length; i += 2) {
    const date = text(list[i]);
    const label = text(list[i + 1]);
    if (label) pairs.push({ date, label });
  }
  const seen = new Set();
  const steps = pairs.map(({ date, label }) => {
    let unique = label;
    if (seen.has(unique)) unique = date ? `${label} (${date})` : label;
    for (let n = 2; seen.has(unique); n += 1) unique = `${label} (${n})`;
    seen.add(unique);
    return { label: unique, detail: date || undefined, year: /^\d{4}$/.test(date) ? Number(date) : null };
  });
  // "Latest on record" only when every step is dated by year and the list runs oldest to newest.
  const ordered = steps.length > 0 && steps.every((s, i) => s.year != null && (i === 0 || s.year >= steps[i - 1].year));
  return steps.map(({ label, detail }, i) => ({ label, detail, done: ordered ? i < steps.length - 1 : true, now: ordered && i === steps.length - 1 }));
}

export default function alliances(row, ctx = {}) {
  const flags = ctx.feed?.meta?.memberFlags && typeof ctx.feed.meta.memberFlags === 'object' ? ctx.feed.meta.memberFlags : null;
  const p = hydrateAlliance(row || {}, flags || {});
  const title = text(p.name) || text(p.short) || 'Alliance';
  const names = p.members;
  const total = names.length;
  const standing = statusOf(p.status);
  const records = memberRecords(p, flags || {});
  const summary = flags ? memberSummary(p, flags) : null;
  const flagged = flags ? records.filter((m) => m.tone === 'exception' || m.tone === 'review') : [];
  const binding = p.legalBasis ? bindingType(p) : '';
  const asOf = asOfLabel(p.verified) || asOfLabel(ctx.feed?.meta?.verified) || asOfLabel(ctx.feed?.coverage?.through);

  // Member map: only members the lookup can place; the rest are counted, never guessed.
  const seat = seatMember(p.seat, names);
  const points = records
    .map((m) => ({ m, at: countryPosition(m.country) }))
    .filter(({ at }) => at)
    .map(({ m, at }) => ({ lat: at.lat, lon: at.lon, label: m.country, tone: flags && Object.hasOwn(TONE_OF_STANDING, m.tone) ? TONE_OF_STANDING[m.tone] : 'blue', approximate: true, ...(m.country === seat ? { main: true } : {}) }));
  const unplaced = names.filter((n) => !countryPosition(n));
  const legend = ['amber', 'green', 'red'].filter((t) => points.some((pt) => pt.tone === t)).map((t) => `${t}: ${LEGEND[t]}`);
  const mapCaption = [
    `Showing ${points.length} of ${total} members at approximate country centres.`,
    unplaced.length && unplaced.length <= 4 ? `Not placed: ${unplaced.join(', ')}.` : '',
    seat ? `${seat}, the seat country, is highlighted.` : '',
    legend.length ? `Blue is a recorded member; ${legend.join('; ')}.` : '',
  ].filter(Boolean).join(' ');

  const steps = milestoneSteps(p.milestones);

  // Callout: a qualified status as written, and the roster exceptions and reviews the register flags.
  const callout = [
    standing?.qualified ? `Status on record: ${standing.qualified}.` : '',
    flagged.length ? `Roster flags: ${flagged.map((m) => `${m.country} (${m.standing})`).join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  // Membership overlap: the blocs sharing the most members, never this bloc or a copy of it.
  const others = (ctx.rows || []).map((r) => hydrateAlliance(r, {})).filter((x) => x?.id && x.id !== p.id && !(p.name && x.name === p.name));
  const shared = total ? overlaps(p, others).slice(0, 3) : [];
  const seenTitles = new Set();
  const links = shared
    .map((x) => ({ title: text(x.p.short) || text(x.p.name), detail: `${plural(x.n, 'common member')} · ${Math.round((x.n / total) * 100)}% of this roster`, row: x.p.row }))
    .filter((l) => l.title && !seenTitles.has(l.title) && seenTitles.add(l.title));

  const region = text(p.region);

  return {
    title,
    meta: [...new Set([text(p.short), text(p.category), region].filter(Boolean))],
    badge: standing?.badge,
    links: sourceLinks(row, text(p.sourceLabel) || 'Source'),
    glance: {
      tiles: [
        { label: 'Members', value: total ? String(total) : NOT_ON_RECORD, sub: summary ? `${summary.active} active or full` : 'roster entries' },
        { label: 'Formed', value: text(p.formed) || NOT_ON_RECORD, sub: text(p.formed) ? 'as listed' : undefined },
        { label: 'Obligation', value: p.obligation ? p.obligationKind : NOT_ON_RECORD, sub: p.obligation ? 'obligation class' : undefined },
        { label: 'Latest record', value: text(p.latestDate) || NOT_ON_RECORD, sub: text(p.latestDate) ? 'latest development' : undefined },
      ],
      visual: points.length ? {
        type: 'map',
        title: 'Member states',
        right: `${total} members`,
        points,
        caption: mapCaption,
      } : undefined,
      visual2: steps.length ? {
        type: 'timeline',
        title: 'Roster history',
        right: total ? `${total} members` : undefined,
        steps,
        caption: steps.some((s) => s.now)
          ? 'Milestones as held on the register, dates as listed. The highlighted step is the latest one on record.'
          : 'Milestones as held on the register, dates as listed.',
      } : undefined,
      callout: callout ? { tone: 'amber', text: callout } : undefined,
    },
    about: {
      label: '02 · About this bloc',
      rows: presentRows([
        ['Legal basis', p.legalBasis],
        ['Binding form', binding && binding !== BINDING_FALLBACK ? binding : ''],
        ['Structure', p.category],
        ['Seat', p.seat],
        ['Formed', p.formed],
        ['Decision rule', p.decision],
        ['Obligation', p.obligation],
        ['Core purpose', p.scope],
        ['Chair', p.chair],
        ['Agenda', p.agenda.join(' · ')],
        ['Bodies and instruments', p.instruments.join(' · ')],
      ]),
      chips: names,
      cards: [
        ...(text(p.latest) ? [{ heading: text(p.latestDate) ? `Latest verified development · ${text(p.latestDate)}` : 'Latest verified development', body: text(p.latest) }] : []),
        ...(text(p.next) ? [{ heading: 'Monitor next', body: text(p.next) }] : []),
      ],
    },
    touches: {
      label: '03 · Bloc & what it touches',
      links,
    },
    footer: {
      ask: 'Ask AI about this alliance',
      provenance: {
        source: text(p.sourceLabel) ? `${text(p.sourceLabel)}, as listed in the alliance and bloc register` : 'Alliance and bloc register (stored on the platform)',
        asOf: asOf || undefined,
        flags: asOf ? [] : ['as-of not on record'],
      },
      note: `This is the platform's stored alliance and bloc register${asOf ? `, verified ${asOf}` : ''}, not a live feed. Rosters change${flags ? '; roster standing is categorical, from the register\'s member flags, and is not a score' : ''}.`,
    },
  };
}
