import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import commodities from '../data/commodities.json';
import leaders from '../data/leaders.json';
import { bindingType, memberRecord } from '../lib/alliances.js';
import { flattenLeader, leadersFromPack } from '../lib/globalResources.js';
import { flattenLaunch } from '../../server/assetsApi.mjs';
import CommoditiesDesk from './CommoditiesDesk.jsx';
import LeadersDesk from './LeadersDesk.jsx';

// F122 G2: labels and sources on the Global desk say no more than the data holds.

const commodityFeed = {
  feature: 'Global Commodities',
  rows: commodities.groups.flatMap((g) => g.items.map(([commodity, level, change, pct]) => ({ commodity, level, change, pct, group: g.g }))),
  meta: { groups: commodities.groups, stats: commodities.stats, asOf: commodities.meta.asOf },
};

describe('Global Commodities desk', () => {
  const html = renderToStaticMarkup(<CommoditiesDesk feed={commodityFeed} />);

  it('does not call illustrative pack levels live or API-ready', () => {
    expect(html).not.toMatch(/API-ready/);
    expect(html).toMatch(/Illustrative/);
  });

  it('does not name Trading Economics or CME as sources of the levels', () => {
    expect(html).not.toMatch(/tradingeconomics|cmegroup|Trading Economics|CME Group/);
    expect(html).toMatch(/for checking/);
    expect(html).toMatch(/no live price feed/);
  });
});

describe('Heads of State desk', () => {
  it('says the profiles come from the register, and offers outside sites only for checking', () => {
    const rows = leadersFromPack(leaders);
    const html = renderToStaticMarkup(<LeadersDesk feed={{ feature: 'Heads of State', rows, meta: { asOf: leaders.asOf, stats: leaders.stats } }} />);
    expect(html).toMatch(/Wikidata \(for checking\)/);
    expect(html).toMatch(/not pulled from these sites/);
    expect(html).not.toMatch(/gov\.uk/);
    expect(html).toMatch(new RegExp(`${rows.length} PROFILES`));
    expect(rows.length).toBe(leaders.stats.tracked - 1);
  });
});

describe('Heads of State rows', () => {
  it('flags a row named by its office, not its holder, as not verified', () => {
    for (const name of ['UK Prime Minister', 'German Chancellor', 'Japan PM', 'South Korea President', 'Poland (govt)', 'Bangladesh (interim)', 'Taliban (IEA)', 'Vietnam (CPV)', 'Qatar (Emir)', 'UAE (President)', 'Cuba (President)']) {
      expect(flattenLeader({ id: 'x', name, role: 'President', country: 'X' }).name, name).toBe('Not verified');
    }
  });

  it('keeps a named holder as written', () => {
    for (const name of ['Narendra Modi', 'MBS (Crown Prince)', 'Venezuela (Maduro)', 'Kim Jong Un']) {
      expect(flattenLeader({ id: 'x', name, role: 'President', country: 'X' }).name, name).toBe(name);
    }
  });
});

describe('Satellite launches', () => {
  it('gives no record link when the only link is the Launch Library JSON endpoint', () => {
    const row = flattenLaunch({ id: 'a1', name: 'Falcon 9 | Starlink', url: 'https://ll.thespacedevs.com/2.2.0/launch/a1/?format=json', pad: { wiki_url: 'https://en.wikipedia.org/wiki/Pad', location: { name: 'Vandenberg' } } });
    expect(row.source_url).toBe('');
    expect(row.api_url).toBe('https://ll.thespacedevs.com/2.2.0/launch/a1/?format=json');
  });
});

describe('Alliances fallbacks', () => {
  it('say "Not stated" rather than a binding form or a standing the row does not hold', () => {
    expect(bindingType({ legalBasis: 'Leaders’ communiqués' })).toBe('Not stated');
    expect(bindingType({ legalBasis: 'North Atlantic Treaty' })).toBe('Treaty / protocol');
    expect(memberRecord({ members: ['India'], agenda: [], category: 'Forum' }, 'India').standing).toBe('Not stated');
  });
});
