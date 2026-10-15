import commoditiesPack from '../../../data/commodities.json';
import { othersSharing } from '../touchRules.js';
import { dateLabel, presentRows, sourceLinks } from './common.js';

/**
 * Global Commodities (benchmark board) → record panel (F121). The levels are illustrative values in
 * the platform's own benchmark pack, not market quotes, and the panel says so. Units are shown as
 * the pack writes them. The pack's `pct` field is only the length of a bar on the desk, so it is
 * not used here.
 */
const MOVE_TONE = { up: 'green', down: 'red' };

/** Direction of a change string such as "+4.1%" or "-1.2%"; null unless it is a signed (or zero) percentage. */
function moveOf(change) {
  const m = /^\s*([+\-−]?)\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(String(change ?? ''));
  if (!m) return null;
  if (Number(m[2]) === 0) return { dir: 'flat', size: m[2] };
  if (!m[1]) return null;
  return { dir: m[1] === '+' ? 'up' : 'down', size: m[2] };
}

function badgeOf(move) {
  if (!move) return undefined;
  if (move.dir === 'flat') return { text: 'Flat', tone: 'grey' };
  return { text: `${move.dir === 'up' ? 'Up' : 'Down'} ${move.size}%`, tone: MOVE_TONE[move.dir] };
}

const nameOf = (row) => String(row?.commodity || row?.title || '').trim();
const sameName = (a, b) => nameOf(a).toLowerCase() === nameOf(b).toLowerCase();

export default function commodities(row, ctx = {}) {
  const title = nameOf(row) || 'Commodity';
  const group = String(row.group || '').trim();
  const level = String(row.level || '').trim();
  const change = String(row.change || '').trim();
  const move = moveOf(change);
  const tone = move ? MOVE_TONE[move.dir] : undefined;
  // The feed sets meta.asOf; the pack's own month covers a feed that does not.
  const asOf = dateLabel(ctx.feed?.meta?.asOf || commoditiesPack.meta?.asOf);
  const rows = ctx.rows || [];
  // Count and list the same set: the group-mates, never the selection itself (it may be a copy of its feed row).
  const sameGroup = othersSharing(rows, row, 'group');
  const mates = group ? rows.filter((r) => String(r.group || '').trim().toLowerCase() === group.toLowerCase() && !sameName(r, row)) : [];

  const boardRow = (r, self) => {
    const rChange = String(r.change || '').trim();
    const rMove = moveOf(rChange);
    const note = [rChange, self ? 'This benchmark' : ''].filter(Boolean).join(' · ');
    return { label: nameOf(r) || 'Commodity', value: String(r.level || '').trim() || 'Not on record', note: note || undefined, tone: rMove ? MOVE_TONE[rMove.dir] : undefined };
  };

  return {
    title,
    meta: ['Commodity benchmark', group].filter(Boolean),
    badge: badgeOf(move),
    links: sourceLinks(row, 'Background: World Bank commodity markets'),
    glance: {
      tiles: [
        { label: 'Level (illustrative)', value: level || 'Not on record', sub: 'benchmark value' },
        ...(change ? [{ label: 'Change', value: change, tone }] : []),
        { label: 'Group', value: group || 'Not on record' },
        { label: 'As of', value: asOf || 'Not on record', sub: 'benchmark month' },
      ],
      visual: mates.length ? {
        type: 'board',
        title: 'Benchmark board',
        right: asOf || undefined,
        rows: [boardRow(row, true), ...mates.map((r) => boardRow(r, false))],
        caption: `Illustrative benchmark levels${asOf ? ` as of ${asOf}` : ''}, not market quotes. Levels and units are shown as the benchmark set states them.`,
      } : undefined,
      callout: {
        tone: 'amber',
        text: `Illustrative levels from the platform's benchmark set${asOf ? ` as of ${asOf}` : ''}. They are not market quotes, and no market data feed is connected.`,
      },
    },
    about: {
      label: '02 · About this benchmark',
      rows: presentRows([['Group', group], ['Level', level], ['Change', change]]),
    },
    touches: {
      label: '03 · Benchmark & what it touches',
      links: sameGroup ? [{ title: `Other ${group} benchmarks`, detail: `${sameGroup} more in the benchmark set` }] : [],
    },
    footer: {
      ask: 'Ask AI about this benchmark',
      provenance: {
        source: 'Niyantran commodity benchmark set (illustrative levels)',
        asOf,
        flags: ['illustrative levels', ...(asOf ? [] : ['as-of not on record'])],
      },
      note: 'Illustrative benchmark levels for orientation, not market quotes. Units are shown as the benchmark set writes them.',
    },
  };
}
