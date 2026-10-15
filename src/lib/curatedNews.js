/**
 * F196: modules answered by a curated Google News topic search. The search words are the module's
 * entry in FEATURE_TOPIC_Q (server/featureFeed.mjs); this table says how the answer is kept: only
 * headlines the module's title guard accepts (the search alone lets through off-topic stories),
 * each link once, newest first. Each module is news coverage and says so; none is a register.
 * Kept free of imports so the server, the summaries and the tests can all read it.
 */

const TIER = { economics: 'finance', finance: 'finance', state: 'state', local: 'local', sports: 'sports' };

export const CURATED_NEWS = Object.freeze({
  'sports:Sports Governance & Policy': Object.freeze({
    // The Sports desk's wires answer as `api` (its summary reads only that adapter).
    adapter: 'api',
    section: 'SPORTS GOVERNANCE & POLICY',
    title: /ministry|minister|mandaviya|federation|\bNSFs?\b|association|\bIOA\b|olympic|paralympic|doping|\bNADA\b|\bWADA\b|governance|polic(?:y|ies)|sports code|sports (?:bill|act)|\bSAI\b|sports authority|\bTOPS\b|athletes?'? commission|election|suspend|\bban(?:ned)?\b|2036|\bbid\b|review|funding/i,
    note: 'Google News search for the sports ministry, sports federations, the Indian Olympic Association, anti-doping (NADA) and sports governance law. Reporting, not an official MYAS or National Sports Code register.',
  }),
  "state:Governor Friction & President's Rule Tracker": Object.freeze({
    adapter: 'news-search',
    section: "GOVERNOR FRICTION & PRESIDENT'S RULE",
    title: /governor|\bguv\b|raj bhavan|lok bhavan|president'?s rule|article 356|\bL-?G\b/i,
    note: "Google News search for disputes between governors and state governments: walkouts and rows over the governor's address, withheld assent, Raj Bhavan standoffs, President's Rule (Article 356). Reporting, not a register of proclamations or withheld bills.",
  }),
  'state:Legislative Productivity Comparison': Object.freeze({
    adapter: 'news-search',
    section: 'STATE ASSEMBLY SESSIONS (NEWS)',
    title: /assembly|vidhan sabha|vidhan parishad|legislat|\bhouse\b|sittings?\b|session/i,
    exclude: /national assembly|parliament|lok sabha|rajya sabha|general assembly|pakistan|nepal/i,
    note: 'Google News search for state assembly sessions: sittings, sessions cut short or adjourned sine die, bills passed, walkouts. News coverage only: sittings, hours and bills-passed counts are not measured or compared.',
  }),
  'state:MLA Defection & Anti-defection Case Tracker': Object.freeze({
    adapter: 'news-search',
    section: 'DEFECTION & ANTI-DEFECTION (NEWS)',
    title: /defect|tenth schedule|disqualif|switch(?:ed|es|ing)? (?:sides|parties|party|over)|chang(?:ed|es|ing) parties|\bjoin(?:s|ed|ing)?\b|crossed over|jump(?:ed|s)? ship|turncoat|poach|horse-?trading|merge/i,
    note: 'Google News search for MLA defections, anti-defection (Tenth Schedule) cases, disqualification petitions and Speakers\' decisions. Reporting only: not a register of defections or of pending petitions.',
  }),
});

/** The curated-news settings of a module (by the tier and feature a request names), or null. */
export function curatedNewsFor(tier, feature) {
  const t = String(tier || '').toLowerCase();
  return CURATED_NEWS[`${TIER[t] || t}:${String(feature || '').trim()}`] || null;
}

function isoDay(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

/**
 * The rows a curated-news module shows: headlines its title guard accepts (and its exclusion does
 * not), each link once, newest first, dated YYYY-MM-DD, at most `cap`.
 */
export function curatedNewsRows(rows, spec, cap = 100) {
  const seen = new Set();
  const kept = [];
  for (const row of rows || []) {
    const title = String(row?.title || '').trim();
    if (!title || !spec.title.test(title) || spec.exclude?.test(title)) continue;
    const key = String(row.source_url || title).trim();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...row, title, date: isoDay(row.date) || String(row.date || '') });
  }
  return kept.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, cap);
}
