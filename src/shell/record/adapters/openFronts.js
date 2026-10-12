import geoConflicts from '../../../data/geo-conflicts.json';
import { regionPosition } from '../geoLookup.js';
import { chokepointsForRegion, othersSharing } from '../touchRules.js';
import { cap, dateLabel, plural, presentRows, provenanceFlags, sourceLinks } from './common.js';

/**
 * Open Fronts → record panel (F121). The register classifies each front editorially (stage,
 * intensity, trend); five fronts also have a dossier with coordinates and named sources. No event
 * counts are implied: event data (ACLED) is licence-gated and not wired.
 */
const STAGE = {
  active: { text: 'Active', tone: 'red' },
  'ceasefire fragile': { text: 'Ceasefire fragile', tone: 'amber' },
  'low-intensity': { text: 'Low intensity', tone: 'amber' },
  frozen: { text: 'Frozen', tone: 'grey' },
  'under review': { text: 'Under review', tone: 'blue' },
};
const INTENSITY_TONE = { critical: 'red', high: 'amber' };
const TREND_TONE = { escalating: 'amber', easing: 'green' };

const DOSSIERS = geoConflicts.conflicts || [];
const https = (url) => /^https:\/\//i.test(String(url || ''));

export default function openFronts(row, ctx = {}) {
  const name = row.conflict_name || row.title || 'Front';
  const region = row.region || '';
  const stage = STAGE[String(row.current_stage || '').toLowerCase()] || (row.current_stage ? { text: cap(row.current_stage), tone: 'grey' } : null);
  const dossier = DOSSIERS.find((d) => d.name === name);
  const exact = dossier && Number.isFinite(dossier.lat) ? { lat: dossier.lat, lon: dossier.lon } : null;
  const place = exact || regionPosition(region);
  const context = DOSSIERS.filter((d) => d !== dossier && Number.isFinite(d.lat))
    .map((d) => ({ lat: d.lat, lon: d.lon, label: d.name, tone: 'amber' }));
  const asOf = dateLabel(row.as_of || row.last_verified);
  const chokepoints = chokepointsForRegion(region);
  const sameRegion = othersSharing(ctx.rows, row, 'region');
  const dossierLinks = (dossier?.sources || []).filter(([, url]) => https(url)).map(([label, url]) => ({ label, href: url }));

  return {
    title: name,
    meta: [region, row.conflict_type].filter(Boolean),
    badge: stage || undefined,
    links: [...sourceLinks(row, 'Source records'), ...dossierLinks],
    glance: {
      tiles: [
        { label: 'Intensity', value: cap(row.intensity) || 'Not on record', sub: 'as classified', tone: INTENSITY_TONE[String(row.intensity).toLowerCase()] },
        { label: 'Trend', value: cap(row.trend) || 'Not on record', sub: 'as classified', tone: TREND_TONE[String(row.trend).toLowerCase()] },
        { label: 'Type', value: cap(row.conflict_type) || 'Not on record' },
        { label: 'Register as of', value: asOf || 'Not on record', sub: 'last verification' },
      ],
      visual: place ? {
        type: 'map',
        title: 'Theatre on the map',
        right: stage?.text,
        points: [{ ...place, label: name, tone: stage?.tone === 'red' ? 'red' : 'amber', main: true }, ...context],
        caption: `${exact ? 'Front placed from its dossier coordinates.' : `Front placed at the ${region} region centre.`} Other markers are the fronts with dossier coordinates.`,
      } : undefined,
      callout: {
        tone: 'amber',
        text: 'Intensity and trend are editorial classifications, not event counts. Event-count data (ACLED) is licence-gated and not wired, so no fatality or incident figure is shown from it.',
      },
    },
    about: {
      label: '02 · About this front',
      rows: presentRows([
        ['Began', row.started],
        ['Stage', stage?.text],
        ['Region', region],
        ['Parties', (dossier?.actors || []).join(', ')],
        ['Outside support', (dossier?.supporters || []).join('; ')],
      ]),
      cards: row.latest_development ? [{ heading: 'Latest development (register note)', body: row.latest_development }] : [],
    },
    touches: {
      label: '03 · Front & what it touches',
      lanes: ['REGION', 'FRONT', 'CHOKEPOINTS', 'SAME REGION'],
      nodes: {
        left: region ? { l1: region } : undefined,
        center: { code: 'F', l1: 'This front', l2: stage?.text },
        right: chokepoints.length ? { l1: chokepoints[0], l2: chokepoints.length > 1 ? `+${chokepoints.length - 1} more` : undefined } : undefined,
        far: sameRegion ? { l1: plural(sameRegion, 'other front'), l2: region } : undefined,
      },
      links: [
        ...(chokepoints.length ? [{ title: 'Chokepoints in play', detail: chokepoints.join(', '), to: { tab: 'global', feature: 'Maritime Choke-Points' } }] : []),
        ...(sameRegion ? [{ title: `Other fronts in ${region}`, detail: `${sameRegion} on the register` }] : []),
      ],
    },
    footer: {
      ask: 'Ask AI about this front',
      provenance: {
        source: dossier ? 'Open Fronts conflict register; dossier sources linked above' : 'Open Fronts conflict register',
        asOf,
        flags: [...provenanceFlags(row), 'not ACLED'],
      },
      note: 'A conflict register describes a contested reality. Every classification here comes from the register entry and its as-of date.',
    },
  };
}
