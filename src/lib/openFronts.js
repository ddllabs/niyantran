import geo from '../data/geo-conflicts.json';

const VERIFIED = {
  'rus-ukr': {
    asOf: '31 JUL 2026',
    start: '2022-02-24',
    durationMonths: 53,
    civilian: {
      killed: 1839,
      injured: 10638,
      total: 12477,
      period: 'JAN–JUL 2026',
      source: 'https://ukraine.ohchr.org/en/node/574',
    },
    displacement: {
      refugees: 5.9,
      idp: 3.7,
      total: 9.6,
      asOf: 'END 2025',
      source: 'https://www.unhcr.org/sites/default/files/2026-06/unhcr-annual-results-report-2025-ukraine.pdf',
    },
    beneficiaries: [
      { company: 'Raytheon', systems: 'NASAMS air-defence systems', value: '$1.132B' },
      { company: 'BAE Systems', systems: 'APKWS precision-guided rockets', value: '$583M' },
      { company: 'AEVEX Aerospace', systems: 'Phoenix Ghost unmanned systems', value: '$522M' },
      { company: 'AeroVironment', systems: 'Puma UAS + Switchblade 300/600', value: '$407M' },
      { company: 'Lockheed Martin', systems: 'HIMARS launchers and support', value: '$313M' },
    ],
    contractsSource: 'https://media.defense.gov/2024/May/15/2003465981/-1/-1/1/UKRAINE_INFOGRAPHIC_26APR2024.PDF',
    economy: {
      damage: '>$195B',
      recovery: '~$588B',
      asOf: '31 DEC 2025',
      source: 'https://enlargement.ec.europa.eu/news/updated-ukraine-recovery-and-reconstruction-needs-assessment-released-2026-02-23_en',
    },
  },
};

const ISRAEL_PROCUREMENT = {
  label: 'possible FMS ceilings',
  scope: 'Broader Israeli procurement linked to the theatre; values are possible-sale ceilings, not event-exclusive revenue or company profit.',
  beneficiaries: [
    {
      company: 'Boeing / ATK / L3Harris',
      systems: 'JDAM kits, GBU-39/B bombs, fuzes',
      value: '$6.75B',
      source: 'https://www.dsca.mil/Press-Media/Major-Arms-Sales/Article-Display/Article/4060920/israel-munitions-guidance-kits-fuzes-and-munitions-support',
    },
    {
      company: 'General Dynamics / Ellwood',
      systems: 'MK 84 & BLU-117 bomb bodies',
      value: '$2.04B',
      source: 'https://www.dsca.mil/Press-Media/Major-Arms-Sales/Article-Display/Article/4088258/israel-munitions-and-munitions-support',
    },
    {
      company: 'Caterpillar',
      systems: 'D9R / D9T armoured bulldozers',
      value: '$295M',
      source: 'https://www.dsca.mil/Press-Media/Major-Arms-Sales/Article-Display/Article/4088243/israel-caterpillar-d9-bulldozers',
    },
  ],
};

export function isOpenFronts(feed) {
  return /open fronts/i.test(String(feed?.feature || ''));
}

function norm(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function conflictTokens(v) {
  const stop = { war: 1, conflict: 1, civil: 1, interstate: 1, direct: 1, exchange: 1, shadow: 1, strikes: 1, post: 1, transition: 1, aftermath: 1, the: 1, and: 1, vs: 1 };
  return norm(v).split(' ').filter((x) => x && !stop[x]);
}

function sameConflict(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = conflictTokens(a);
  const tb = conflictTokens(b);
  const shared = ta.filter((x) => tb.includes(x)).length;
  return shared >= 2 && shared / Math.min(ta.length || 1, tb.length || 1) >= 0.6;
}

function titleOf(row) {
  return String(row?.conflict_name || row?.title || row?.headline || row?.name || 'Selected Open Front').trim();
}

function headlineEntities(name) {
  const generic = /\b(war|conflict|civil conflict|insurgency|standoff|tensions|unrest|crisis|strikes|aftermath)\b/gi;
  const parts = String(name || '')
    .replace(/[()]/g, ' ')
    .split(/\s+(?:vs\.?|versus)\s+|[–—/]/i)
    .map((x) => x.replace(generic, '').replace(/\s+/g, ' ').trim())
    .filter((x) => x.length > 1);
  return [...new Set(parts)].slice(0, 4);
}

function prettyDate(v) {
  if (!v) return 'Unknown';
  const s = String(v);
  if (/^\d{4}-\d{2}$/.test(s)) {
    const d = new Date(`${s}-01T00:00:00Z`);
    return d.toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  return s;
}

export function durationLabel(s) {
  const text = String(s || '');
  const ym = text.match(/(19|20)\d{2}/);
  if (!ym) return '—';
  const year = Number(ym[0]);
  const months = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
  const lower = text.toLowerCase();
  let month = 0;
  Object.keys(months).some((k) => {
    if (lower.includes(k)) {
      month = months[k];
      return true;
    }
    return false;
  });
  const now = new Date();
  const total = Math.max(0, (now.getFullYear() - year) * 12 + now.getMonth() - month);
  if (total >= 24) return `${(Math.round((total / 12) * 10) / 10).toFixed(total % 12 ? 1 : 0)}y`;
  return `${total}mo`;
}

function briefFor(d) {
  const trend = norm(d.trend);
  let lead;
  if (/escalat|deteriorat|rising/.test(trend)) {
    lead = 'The near-term analytical focus is whether the latest development widens the conflict or changes external involvement.';
  } else if (/easing|improv|declin/.test(trend)) {
    lead = 'The immediate analytical focus is whether de-escalation holds and produces a durable settlement.';
  } else if (/frozen/.test(norm(d.status))) {
    lead = 'The conflict is dormant rather than resolved; a status change or new external involvement would be material.';
  } else {
    lead = 'The key question is whether the latest development changes the conflict posture or its regional effects.';
  }
  let latest = String(d.latest || 'No recent development is recorded.').replace(/\s+/g, ' ').trim();
  if (latest.length > 185) latest = `${latest.slice(0, 182).replace(/\s+\S*$/, '')}…`;
  return `${lead} ${latest}`;
}

function meaningful(x) {
  return !!x && !/^[-—]$/.test(String(x).trim());
}

export function dossierFor(row) {
  const name = titleOf(row);
  const found = (geo.conflicts || []).find((c) => sameConflict(c.name, name)) || null;
  const c = found || {};
  const intensityMap = { critical: 92, high: 76, medium: 55, low: 30 };
  const intensity = Number(c.intensity) || intensityMap[String(row.intensity || '').toLowerCase()] || 60;
  const actors = (c.actors || []).filter(meaningful);
  const supporters = (c.supporters || []).filter(meaningful);
  const equipment = (c.equipment || []).filter(meaningful);
  const d = {
    id: c.id || `evt-${norm(name).replace(/ /g, '-').slice(0, 28)}`,
    name,
    region: row.region || c.region || 'Unspecified theatre',
    type: row.conflict_type || 'Open Front',
    status: row.current_stage || c.status || 'active',
    trend: row.trend || (c.status === 'escalating' ? 'Escalating' : 'Active'),
    since: row.started || c.since || '',
    intensity,
    intensityLabel: row.intensity || 'Medium',
    latest: row.latest_development || c.latest || 'No material update supplied.',
    fatalities: c.fatalitiesEst || 'Awaiting source-backed estimate',
    displaced: c.displaced || 'Awaiting source-backed estimate',
    actors,
    entities: headlineEntities(name),
    supporters,
    equipment,
    sources: c.sources || [],
    asOf: geo.meta?.asOf || 'prototype',
    hasDossier: Boolean(found),
    prettySince: prettyDate(row.started || c.since || ''),
    age: durationLabel(row.started || c.since || ''),
    brief: '',
  };
  d.brief = briefFor(d);
  d.verified = VERIFIED[d.id] || null;
  if (d.verified) {
    d.beneficiaries = {
      label: 'verified obligations',
      scope: 'Obligated U.S. Ukraine-assistance contract values; not company profit.',
      beneficiaries: d.verified.beneficiaries,
      source: d.verified.contractsSource,
      sourceLabel: 'DoD',
    };
  } else if (/(israel|gaza|hezbollah)/i.test(d.name)) {
    d.beneficiaries = ISRAEL_PROCUREMENT;
  } else {
    d.beneficiaries = null;
  }
  return d;
}

export function impactCards(d) {
  const v = d.verified;
  if (v) {
    return [
      { label: 'Civilian casualties', value: v.civilian.total.toLocaleString(), note: 'OHCHR verified', missing: false },
      { label: 'Forced displacement', value: `${v.displacement.total.toFixed(1)}M`, note: 'UNHCR verified', missing: false },
      { label: 'Direct damage', value: v.economy.damage, note: 'RDNA verified', missing: false },
      { label: 'Recovery need', value: v.economy.recovery, note: 'RDNA estimate', missing: false },
    ];
  }
  const linked = d.hasDossier;
  const fatal = linked && /\d/.test(String(d.fatalities || '')) ? d.fatalities : 'Not reported';
  const displaced = linked && /\d/.test(String(d.displaced || '')) ? d.displaced : 'Not reported';
  return [
    { label: 'Civilian casualties', value: fatal, note: fatal === 'Not reported' ? 'No linked figure' : 'Source-linked estimate', missing: fatal === 'Not reported' },
    { label: 'Forced displacement', value: displaced, note: displaced === 'Not reported' ? 'No linked figure' : 'Source-linked estimate', missing: displaced === 'Not reported' },
    { label: 'Direct economic damage', value: 'Not reported', note: 'No linked figure', missing: true },
    { label: 'Recovery need', value: 'Not reported', note: 'No linked figure', missing: true },
  ];
}
