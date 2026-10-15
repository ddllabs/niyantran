// F196 Party Organisation Map: the India map coloured by each assembly's largest party, the national
// roll-up, the tooltip, the table beside it and the credits.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import IndiaPartyMap, { MAP_CREDIT, formatAsOf } from './IndiaPartyMap.jsx';
import { aggregatePartyStrength, partyStrengthRows } from '../lib/partyStrength.js';
import { partyColor } from '../lib/partyColors.js';
import geo from '../data/india-states-geo.json';

const many = (n, state, party) => Array.from({ length: n }, () => ({ state, party, as_of: '2026-08-19' }));
const result = aggregatePartyStrength([
  ...many(63, 'Kerala', 'Indian National Congress'),
  ...many(41, 'Kerala', 'Communist Party of India (Marxist)'),
  ...many(36, 'Kerala', 'Indian Union Muslim League'),
  ...many(30, 'Goa', 'Bharatiya Janata Party'),
  ...many(10, 'Goa', 'Indian National Congress'),
  ...many(4, 'Mizoram', "Zoram People's Movement"),
  ...many(4, 'Mizoram', 'Mizo National Front'),
]);
const feed = {
  ok: true,
  feature: 'Party Organisation Map',
  rows: partyStrengthRows(result),
  meta: { view: 'party-map', as_of: result.asOf, national: result.national, totalSeats: result.totalSeats, states: result.states.length },
};
const markup = (props = {}) => renderToStaticMarkup(<IndiaPartyMap feed={feed} {...props} />);
const unescape = (t) => t.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe('IndiaPartyMap', () => {
  it('draws a path for every state and union territory', () => {
    const paths = markup().match(/<path [^>]*data-state="[^"]+"/g) || [];
    expect(paths).toHaveLength(geo.states.length);
  });

  it('colours a state by its largest party, a tie and a state without data neutrally', () => {
    const html = unescape(markup());
    expect(html).toMatch(new RegExp(`data-state="Kerala"[^>]*fill="${partyColor('Indian National Congress')}"`));
    expect(html).toMatch(new RegExp(`data-state="Goa"[^>]*fill="${partyColor('Bharatiya Janata Party')}"`));
    expect(html).toMatch(/data-state="Mizoram"[^>]*class="pm-state is-tie"/);
    expect(html).toMatch(/data-state="Ladakh"[^>]*class="pm-state is-empty"/);
    expect(html).toMatch(/data-state="Bihar"[^>]*class="pm-state is-empty"/);
  });

  it('makes each state with data a keyboard-focusable link to its MLA list, named for screen readers', () => {
    const html = unescape(markup());
    const links = html.match(/<a [^>]*class="pm-link"[^>]*>/g) || [];
    expect(links).toHaveLength(3);
    const kerala = links.find((l) => /Kerala/.test(l));
    expect(kerala).toMatch(/href="#\/state\/MLA%20Directory"/);
    expect(kerala).toMatch(/tabindex="0"/);
    expect(kerala).toMatch(/aria-label="Kerala: Indian National Congress, 63 of 140 seats, short of majority by 8. Open the MLA list."/);
    // States without data are not focusable.
    expect(html).not.toMatch(/<a [^>]*aria-label="Ladakh/);
  });

  it('shows the hovered or focused state’s seat breakdown in the tooltip', () => {
    const html = unescape(markup({ initialActive: 'Kerala' }));
    const start = html.indexOf('<div class="pm-tip"');
    const tip = start === -1 ? '' : html.slice(start, html.indexOf('</a>', start) + 4);
    expect(tip).toMatch(/Kerala/);
    expect(tip).toMatch(/140 seats · majority 71/);
    expect(tip).toMatch(/Short of majority by 8/);
    expect(tip).toMatch(/Indian National Congress<\/span><span[^>]*>63/);
    expect(tip).toMatch(/style="width:45%;background:#19aaed"/);
    expect(tip).toMatch(/href="#\/state\/MLA%20Directory"[^>]*>Open Kerala’s MLA list/);
    expect(markup()).not.toMatch(/class="pm-tip"/);
  });

  it('lists every state in a table with seats, largest party, share and majority', () => {
    const html = unescape(markup());
    const heads = [...html.matchAll(/<th scope="col"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(heads).toEqual(['State', 'Seats', 'Largest party', 'Its seats', 'Share', 'Majority']);
    const rows = html.match(/<tr class="pm-row[^"]*"/g) || [];
    expect(rows).toHaveLength(3);
    expect(html).toMatch(/Goa<\/a><\/th><td[^>]*>40<\/td><td>Bharatiya Janata Party<\/td><td[^>]*>30<\/td><td[^>]*>75%<\/td><td>Majority<\/td>/);
    expect(html).toMatch(/Tied: Mizo National Front and Zoram People's Movement/);
  });

  it('rolls up each party across assemblies in a bar above the map', () => {
    const html = unescape(markup());
    expect(html).toMatch(/aria-label="MLAs by party across 3 state assemblies: Indian National Congress 73 \(38.8%\), Communist Party of India \(Marxist\) 41 \(21.8%\)/);
    expect(html).toMatch(/188 MLAs in 3 assemblies/);
  });

  it('credits the map data and dates the party data', () => {
    const html = unescape(markup());
    expect(MAP_CREDIT).toBe('Map data: DataMeet (CC-BY 2.5 India)');
    expect(html).toContain(MAP_CREDIT);
    expect(html).toContain('Party data as of 19 Aug 2026 (MLA register)');
    expect(formatAsOf('2026-07-14')).toBe('14 Jul 2026');
    expect(formatAsOf('')).toBe('an unrecorded date');
  });

  it('names the territories without an assembly in the legend', () => {
    expect(unescape(markup())).toMatch(/No assembly or no data/);
  });

  it('says plainly when there is nothing to show', () => {
    const html = markup({ feed: { ok: true, rows: [], meta: null } });
    expect(html).toMatch(/The MLA register is not available right now/);
    expect(html).not.toMatch(/<table/);
  });
});
