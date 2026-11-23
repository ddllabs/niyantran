import GeoDotsMap from '../../../desks/GeoDotsMap.jsx';

export const TONE_COLOR = { red: '#dc2626', amber: '#d97706', blue: '#1d3fb8', green: '#16a34a', grey: '#6b7280' };

/**
 * A record's place on the world map (F121), drawn on the shared land-dot map. A marker placed at a
 * region or country centre is approximate, and the caption says so; the map is always schematic.
 */
export default function PanelMap({ title, right, visual }) {
  const points = (visual?.points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!points.length) return null;
  const approximate = points.some((p) => p.approximate);
  const dots = points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    name: p.label,
    statusL: p.approximate ? 'approximate position' : 'on record',
    intensity: p.main ? 85 : 35,
    color: TONE_COLOR[p.tone] || TONE_COLOR.blue,
  }));
  const caption = [
    visual.caption,
    approximate ? 'Markers marked approximate show an approximate position, not an exact site.' : '',
    'Schematic map, not to scale; no line here is a border.',
  ].filter(Boolean).join(' ');
  return (
    <div className="rp-viz rp-map">
      <div className="rp-viz-head"><span>{title}</span>{right ? <span>{right}</span> : null}</div>
      <GeoDotsMap points={dots} legend={[]} variant="auto" ariaLabel={`Map: ${points.map((p) => p.label).join(', ')}`} />
      <p className="rp-viz-cap">{caption}</p>
    </div>
  );
}
