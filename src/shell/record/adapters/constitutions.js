import { countryPosition } from '../geoLookup.js';
import { presentRows, sourceLinks } from './common.js';

/**
 * World Constitutions (Constitute Project, constitutions in force) → record panel (F121).
 *
 * Rows come from `loadConstitutions` (server/resourcesApi.mjs lines 59-81): { title, country,
 * enacted, constitution_id, source_url }. Since F202 (2026-10-15) the loader sends `country`
 * already readable ("Bahamas", "Iran"; `constitutionCountryName` in src/lib/globalResources.js), which
 * `readableCountry` below passes through unchanged; it still reads a raw Constitute `country_id`
 * (an underscore-joined name) from an older stored answer. `enacted` is a year string or '', and
 * `constitution_id` is Constitute's own id.
 * The rows hold no text, topics or amendments, so the panel states none.
 *
 * Every row is in force: the loader keeps only records with `in_force === true` (resourcesApi.mjs
 * line 63), so the badge and the "In force" tile are true of every row it can return.
 *
 * The year inside `constitution_id` is deliberately not interpreted. In the live Constitute list
 * (188 in-force records, read 2026-10-13) it equals the year of the latest revision for 187 of
 * them and Kuwait's reinstatement year for the other, and the enactment year for only 42; that is
 * evidence for a reader, not a documented scheme, so the id is shown plainly in About.
 */
const NOT_ON_RECORD = 'Not on record';
const NO_AS_OF = 'as-of not on record';
const SOURCE = 'Constitute Project (constitutions in force)';

/** Ids whose generic reading is wrong or ambiguous. Values come from Constitute's own titles. */
const NAMES = {
  Cote_d_Ivoire: "Côte d'Ivoire", // Constitute title: "Côte d'Ivoire 2016 (rev. 2020)"
  Congo_the: 'Congo (Republic of the)', // "The Congo" would read as the Democratic Republic; title: "Congo (Republic of the) 2015"
};
const ABBREVIATIONS = { Rep: 'Republic', Fed: 'Federated' };
/** Only these countries take "The" in their English short name; elsewhere Constitute's trailing "the" is dropped ("Niger", not "The Niger"). */
const OFFICIAL_THE = new Set(['Gambia', 'Bahamas']);

const words = (s) => s.replace(/_s(?=_|$)/g, "'s").replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Constitute's `country_id` as a reader would write the country. The ids follow three conventions:
 *   "Gambia__the", "Niger_the"            → "The Gambia", "Niger"  (only The Gambia and The Bahamas keep it)
 *   "Iran_Islamic_Rep_of_"                → "Iran (Islamic Republic of)"  (name, then its qualifier)
 *   "Lao_People_s_Democratic_Republic__the" → "Lao People's Democratic Republic"
 * Anything else only has its underscores turned into spaces ("Bosnia_and_Herzegovina").
 */
export function readableCountry(id) {
  const raw = String(id ?? '').trim();
  if (!raw) return '';
  if (Object.hasOwn(NAMES, raw)) return NAMES[raw];
  const inverted = /^([^_]+)_{1,2}(.+)_of_$/.exec(raw);
  if (inverted) {
    const qualifier = words(inverted[2]).split(' ').map((w) => (Object.hasOwn(ABBREVIATIONS, w) ? ABBREVIATIONS[w] : w)).join(' ');
    return `${inverted[1]} (${qualifier} of)`;
  }
  const withThe = /^(.+?)_{1,2}the$/.exec(raw);
  if (withThe) return OFFICIAL_THE.has(withThe[1].replace(/_+$/, '')) ? `The ${words(withThe[1])}` : words(withThe[1]);
  return words(raw);
}

/** The four-digit year in `enacted`, or ''. Anything else is not a year and is not read as one. */
const yearOf = (enacted) => (/^\d{4}$/.test(String(enacted ?? '').trim()) ? String(enacted).trim() : '');
const decadeOf = (year) => (year ? `${Math.floor(Number(year) / 10) * 10}s` : '');

/** The same record: by Constitute id when both rows have one, else by country (the selection may be a copy of its feed row). */
const sameRecord = (a, b) => {
  if (a === b) return true;
  if (a?.constitution_id && b?.constitution_id) return a.constitution_id === b.constitution_id;
  return Boolean(a?.country) && a.country === b?.country;
};

export default function constitutions(row, ctx = {}) {
  const title = readableCountry(row.country) || readableCountry(row.title) || 'Constitution';
  const year = yearOf(row.enacted);
  const decade = decadeOf(year);
  const id = String(row.constitution_id ?? '').trim();
  const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
  const sameDecade = decade ? rows.filter((r) => !sameRecord(r, row) && decadeOf(yearOf(r?.enacted)) === decade).length : 0;
  const where = countryPosition(row.country);

  return {
    title,
    meta: ['Constitution in force'],
    badge: { text: 'In force', tone: 'green' },
    links: sourceLinks(row, 'Constitute Project'),
    glance: {
      tiles: [
        { label: 'Enacted', value: year || NOT_ON_RECORD, sub: year ? 'year enacted' : 'year enacted, per Constitute' },
        { label: 'In force', value: 'Yes', sub: 'per Constitute Project', tone: 'green' },
        { label: 'Decade', value: decade || NOT_ON_RECORD, sub: 'decade enacted' },
      ],
      visual: where ? {
        type: 'map',
        title: 'Country on the map',
        right: title,
        points: [{ ...where, label: title, tone: 'blue', main: true }],
        caption: `${title} is placed at country level (approximate); the data holds no coordinates.`,
      } : undefined,
    },
    about: {
      label: '02 · About this constitution',
      rows: presentRows([
        ['Country', title],
        ['Enacted', year || NOT_ON_RECORD],
        ['Constitute id', id],
      ]),
      cards: [{
        heading: 'What this record is',
        body: `Constitute Project lists this as the constitution currently in force for this country. The terminal holds only the country, the enactment year and Constitute's own id for it: no text, topics or amendments.${id ? ' The id is Constitute\'s own key; its year need not match the enactment year.' : ''}`,
      }],
    },
    touches: {
      label: '03 · Constitution & what it touches',
      links: sameDecade ? [{ title: `Other constitutions from the ${decade}`, detail: `${sameDecade} more in force on this list` }] : [],
    },
    footer: {
      ask: 'Ask AI about this constitution',
      // The feed envelope (server/featureFeed.mjs, World Constitutions) carries no fetch time, so there is no as-of date.
      provenance: { source: SOURCE, flags: [NO_AS_OF] },
      // WC_TTL = 7 days (server/resourcesApi.mjs line 9, checked at line 60); the feed note says the same (featureFeed.mjs).
      note: 'The list is fetched live from the Constitute Project and cached for up to 7 days, so it carries no as-of time. It lists constitutions currently in force. Each row gives the country, the enactment year and Constitute\'s id, not the constitution\'s content.',
    },
  };
}
