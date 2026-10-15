/**
 * Facts about Parliament's records that the sources themselves state (F125, F126;
 * docs/specs/2026-10-13-cabinet-filter-mp-house.md). Nothing here infers: a body, house or party is
 * named only where the source names it, and an ambiguous name is left exactly as held.
 */

/**
 * Whether a PIB release's issuing body (its page's ministry field) is the Cabinet or one of its
 * committees, the only bodies that issue Cabinet decisions. PIB names them "Cabinet", "Cabinet
 * Committee on Economic Affairs (CCEA)", "Appointments Committee of the Cabinet" and so on. The
 * Cabinet Secretariat is a department, not the Cabinet. The Hindi names are an unverified fallback for
 * a page that only loaded in Hindi.
 */
export function isCabinetBody(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (/secretariat|सचिवालय/i.test(s)) return false;
  return /^cabinet$/i.test(s) || /^cabinet committee\b/i.test(s) || /\bcommittee of the cabinet$/i.test(s) || /मंत्रिमंडल/.test(s);
}

/**
 * A Cabinet decision on PIB: the issuing body is the Cabinet or a Cabinet committee (F125), or the
 * release is on pib.gov.in and its title starts "Cabinet approves" or "Cabinet apprises" (owner,
 * 2026-10-14: PIB files many decisions under the ministry concerned). General news is still left out.
 */
export function isCabinetDecision(row) {
  if (isCabinetBody(row?.ministry)) return true;
  const title = String(row?.title ?? row?.topic ?? '').replace(/\s+/g, ' ').trim();
  const link = String(row?.source_url || row?.link || row?.url || '');
  return /^https?:\/\/(?:www\.)?pib\.gov\.in\//i.test(link) && /^(?:union )?cabinet (?:approves|apprises|apprised)\b/i.test(title);
}

/** The PRID of a PIB release row: its own `prid`, else the one in its link; '' when it has none. */
function releasePrid(row) {
  const own = String(row?.prid ?? '').trim();
  if (/^\d+$/.test(own)) return own;
  return /PRID=(\d+)/i.exec(String(row?.source_url || row?.link || row?.url || ''))?.[1] || '';
}

/**
 * The key releases of one decision share (F187): the title (case and spacing ignored) and the day.
 * '' for a row with no title or no day, which is never grouped.
 */
export function cabinetReleaseGroup(row) {
  const title = String(row?.title ?? row?.topic ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const day = String(row?.date ?? '').trim().slice(0, 10);
  return title && day ? `${title}|${day}` : '';
}

/** Of two releases of one decision, whether `a` is the one to keep: the Cabinet's or a committee's, else the lower PRID. */
export function cabinetPrefers(a, b) {
  const bodyA = isCabinetBody(a?.ministry);
  const bodyB = isCabinetBody(b?.ministry);
  if (bodyA !== bodyB) return bodyA;
  return Number(releasePrid(a) || Infinity) < Number(releasePrid(b) || Infinity);
}

/**
 * One row per Cabinet decision (F187). PIB often publishes a decision twice on one day, as the
 * ministry's "Cabinet approves…" release and as the Cabinet's or a Cabinet committee's own (different
 * PRIDs, one title). Of each such pair the release issued by the Cabinet or a committee is kept
 * (cabinetPrefers), else the lower PRID. The kept rows keep their order and their place in it; rows
 * with no title or day are kept as they are. The input is not changed.
 */
export function pickReleasePairs(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const best = new Map();
  for (const row of list) {
    const group = cabinetReleaseGroup(row);
    if (!group) continue;
    const held = best.get(group);
    if (!held || cabinetPrefers(row, held)) best.set(group, row);
  }
  return list.filter((row) => {
    const group = cabinetReleaseGroup(row);
    return !group || best.get(group) === row;
  });
}

/** Lok Sabha or Rajya Sabha from a member's own sansad.in profile link; '' for anything else. */
export function mpHouseOf(url) {
  const m = /^https:\/\/sansad\.in\/(ls|rs)\//i.exec(String(url ?? '').trim());
  if (!m) return '';
  return m[1].toLowerCase() === 'ls' ? 'Lok Sabha' : 'Rajya Sabha';
}

/**
 * Full party names held on the Rajya Sabha rows → the abbreviation the Lok Sabha rows use. Only pairs
 * that are certainly the same party: "Shiv Sena" and "Nationalist Congress Party" each split into two
 * parties, and "Independent & Others" is a grouping, so those are not mapped.
 */
const PARTY_ABBREVIATIONS = new Map(Object.entries({
  'bharatiya janata party': 'BJP',
  'indian national congress': 'INC',
  'all india trinamool congress': 'AITC',
  'dravida munnetra kazhagam': 'DMK',
  'all india anna dravida munnetra kazhagam': 'AIADMK',
  'telugu desam party': 'TDP',
  'biju janata dal': 'BJD',
  'ysr congress party': 'YSRCP',
  'yuvajana sramika rythu congress party': 'YSRCP',
  'samajwadi party': 'SP',
  'janata dal (united)': 'JD(U)',
  'rashtriya janata dal': 'RJD',
  'jharkhand mukti morcha': 'JMM',
  'communist party of india (marxist)': 'CPI(M)',
  'communist party of india': 'CPI',
  'bharat rashtra samithi': 'BRS',
  'aam aadmi party': 'AAP',
  'j&k national conference': 'J&KNC',
  'indian union muslim league': 'IUML',
  'united peoples party (liberal)': 'UPPL',
}));

/** The party as the Lok Sabha rows abbreviate it, when the name certainly means that party; else as held. */
export function canonicalParty(name) {
  const held = String(name ?? '').replace(/\s+/g, ' ').trim();
  return PARTY_ABBREVIATIONS.get(held.toLowerCase()) || held;
}

/** The MP register with `house` from each member's own link and a unified `party`; the original stays in `party_raw`. */
export function shapeMpRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    if (!r || typeof r !== 'object' || r.status === 'source_status') return r;
    return { ...r, house: r.house || mpHouseOf(r.source_url), party_raw: r.party_raw ?? r.party, party: canonicalParty(r.party_raw ?? r.party) };
  });
}
