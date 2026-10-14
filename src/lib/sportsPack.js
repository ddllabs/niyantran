/**
 * Sports desk. GDELT news searches are not fixtures, scoreboards, or athlete directories.
 */

import { isoDate } from './carbonPack.js';

export function sportsSlice(feature) {
  const n = String(feature || '');
  const hit = [
    [/^cricket wire$/i, 'cricket'],
    [/^fixtures & results/i, 'fixtures'],
    [/^football wire$/i, 'football'],
    [/^isl tracker$/i, 'isl'],
    [/^indian sports wire$/i, 'india'],
    [/^sports governance/i, 'governance'],
    [/^sports business/i, 'business'],
    [/^athlete index$/i, 'athletes'],
  ].find(([re]) => re.test(n));
  return hit ? hit[1] : '';
}

export function sportsNote(slice, extra = '') {
  const notes = {
    cricket: 'ESPNcricinfo story RSS — matches, results and reports. Not a GDELT search.',
    fixtures:
      'TheSportsDB next and last events for Premier League, NBA, IPL and La Liga. Not a news search.',
    football: 'BBC Sport football RSS. Not a GDELT search.',
    isl: 'ESPN Indian Super League scoreboard. TheSportsDB ISL is the fallback if ESPN is empty.',
    india:
      'Google News RSS for India hockey, badminton, kabaddi, athletics and chess (7 days). Not a GDELT search.',
    governance:
      'No extracted MYAS/NSF table. GDELT was not used as a stand-in, and no records were invented.',
    business:
      'Wikidata Indian leagues and owners. Broadcast rights valuations and sponsorships are not in this pull.',
    athletes:
      'Wikidata people with occupation athlete and country India. Rankings, medals and endorsements are not in this pull.',
  };
  const base = notes[slice] || 'Sports pack.';
  return extra ? `${base} ${extra}` : base;
}

export function rssWireRows(raw, outlet) {
  return (raw || [])
    .map((r) => {
      const title = String(r.title || '').trim();
      if (!title) return null;
      return {
        title,
        outlet: r.outlet || outlet || '',
        date: isoDate(r.date),
        source_url: r.source_url || r.link || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function sportsDbRows(json, leagueName = '') {
  const events = json?.events || json?.event || [];
  return events
    .map((e) => {
      const title = String(e.strEvent || `${e.strHomeTeam || ''} vs ${e.strAwayTeam || ''}`).trim();
      if (!title || title === 'vs') return null;
      const hs = e.intHomeScore;
      const as = e.intAwayScore;
      const played = hs != null && hs !== '' && as != null && as !== '';
      return {
        title,
        league: e.strLeague || leagueName,
        date: isoDate(e.dateEvent || e.strTimestamp),
        time: e.strTime || '',
        home: e.strHomeTeam || '',
        away: e.strAwayTeam || '',
        home_score: hs ?? '',
        away_score: as ?? '',
        status: played ? 'Result' : 'Fixture',
        source_url: e.idEvent ? `https://www.thesportsdb.com/event/${e.idEvent}` : '',
      };
    })
    .filter(Boolean);
}

export function espnScoreboardRows(json, leagueName = '') {
  const events = json?.events || [];
  return events
    .map((e) => {
      const comp = e.competitions?.[0];
      const comps = comp?.competitors || [];
      const home = comps.find((c) => c.homeAway === 'home') || comps[0];
      const away = comps.find((c) => c.homeAway === 'away') || comps[1];
      const hn = home?.team?.displayName || '';
      const an = away?.team?.displayName || '';
      const title = String(e.name || (an && hn ? `${an} at ${hn}` : '')).trim();
      if (!title) return null;
      return {
        title,
        league: json?.leagues?.[0]?.name || leagueName,
        date: isoDate(e.date),
        home: hn,
        away: an,
        home_score: home?.score ?? '',
        away_score: away?.score ?? '',
        status: comp?.status?.type?.shortDetail || comp?.status?.type?.description || '',
        // F169 T5: what the match is, from ESPN's state: pre, in or post.
        stage: { pre: 'Upcoming', in: 'Live', post: 'Result' }[comp?.status?.type?.state] || '',
        source_url: e.links?.find((l) => l.rel?.includes('desktop') || l.href)?.href || e.links?.[0]?.href || '',
      };
    })
    .filter(Boolean);
}

export function wikidataLeagueRows(json) {
  const bindings = json?.results?.bindings || [];
  const seen = new Set();
  const rows = [];
  for (const b of bindings) {
    const league = b.leagueLabel?.value || '';
    if (!league || /^Q[0-9]+$/.test(league)) continue;
    const owner = b.ownerLabel?.value && !/^Q[0-9]+$/.test(b.ownerLabel.value) ? b.ownerLabel.value : '';
    const k = `${league}|${owner}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({
      title: league,
      league,
      owner: owner || '—',
      source_url: String(b.league?.value || 'https://www.wikidata.org/').replace(/^http:\/\//i, 'https://'),
    });
  }
  return rows.sort((a, b) => String(a.league).localeCompare(String(b.league)));
}

export function wikidataAthleteRows(json) {
  const bindings = json?.results?.bindings || [];
  const seen = new Set();
  const rows = [];
  for (const b of bindings) {
    const person = b.personLabel?.value || '';
    if (!person || /^Q[0-9]+$/.test(person)) continue;
    const sport = b.sportLabel?.value && !/^Q[0-9]+$/.test(b.sportLabel.value) ? b.sportLabel.value : '';
    const k = `${person}|${sport}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({
      title: person,
      person,
      sport: sport || '—',
      source_url: String(b.person?.value || 'https://www.wikidata.org/').replace(/^http:\/\//i, 'https://'),
    });
  }
  return rows.sort((a, b) => String(a.person).localeCompare(String(b.person)));
}

export const CRICKET_RSS = 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml';
export const FOOTBALL_RSS = 'https://feeds.bbci.co.uk/sport/football/rss.xml';
export const INDIA_SPORTS_RSS =
  'https://news.google.com/rss/search?q=India+hockey+OR+badminton+OR+kabaddi+OR+athletics+OR+chess+when:7d&hl=en-IN&gl=IN&ceid=IN:en';

export const WORLD_LEAGUES = [
  { id: '4328', name: 'Premier League' },
  { id: '4387', name: 'NBA' },
  { id: '4335', name: 'La Liga' },
  { id: '4460', name: 'IPL' },
];

export const ISL_ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/ind.1/scoreboard';
export const ISL_SPORTSDB = '4791';

export const WD_LEAGUES_Q =
  'SELECT ?league ?leagueLabel ?owner ?ownerLabel WHERE { ' +
  '?league wdt:P31/wdt:P279* wd:Q623109; wdt:P17 wd:Q668. ' +
  'OPTIONAL { ?league wdt:P127 ?owner. } ' +
  'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 500';

export const WD_ATHLETES_Q =
  'SELECT ?person ?personLabel ?sportLabel WHERE { ' +
  '?person wdt:P31 wd:Q5; wdt:P106 wd:Q2066131; wdt:P27 wd:Q668. ' +
  'OPTIONAL { ?person wdt:P641 ?sport. } ' +
  'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 500';
