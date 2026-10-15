#!/usr/bin/env node
/**
 * F196 Party Organisation Map: build src/data/india-states-geo.json, the state shapes the map draws,
 * from DataMeet's States/Admin2 shapefile (https://github.com/datameet/maps, CC-BY 2.5 India). The
 * layer follows the Survey of India external boundary (DataMeet updated Jammu & Kashmir and Ladakh to
 * the 2019 SOI map in 2021); src/lib/indiaStatesGeo.test.js checks the shipped file against it.
 *
 *   node scripts/build-india-states-geo.mjs <folder holding Admin2.shp and Admin2.dbf> [--tolerance 0.45]
 *
 * The shapefile is not kept in the repository: download States/Admin2.{shp,shx,dbf,prj} into an empty
 * folder outside it and pass that folder. No dependencies: a minimal polygon .shp reader and .dbf reader,
 * Douglas–Peucker simplification in projected units, and integer coordinates written as relative SVG
 * paths. The projection is equirectangular with the longitude scaled by the cosine of the middle
 * latitude; `projection` in the file reads a point back (lon = x / kx + lon0, lat = lat1 - y / ky).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MLA_STATE_NAMES } from '../src/lib/mlaStates.js';

export const ATTRIBUTION = 'Map data: DataMeet (CC-BY 2.5 India)';
const SOURCE = 'https://github.com/datameet/maps (States/Admin2)';
const OUT = 'src/data/india-states-geo.json';
/** Projected units per degree of latitude: India's 31° of latitude become about 1,000 units. */
const UNITS_PER_DEGREE = 32;
/** Douglas–Peucker tolerance in projected units (one unit is about 3.5 km). */
export const DEFAULT_TOLERANCE = 0.45;
/** Rings smaller than this (square units, after simplification) are dropped, except a state's largest. */
const MIN_RING_AREA = 3;

/** States and union territories without a legislative assembly, by DataMeet's names, with a code. */
const NO_ASSEMBLY = Object.freeze({
  'Andaman & Nicobar': 'AN',
  Chandigarh: 'CH',
  'Dadra and Nagar Haveli and Daman and Diu': 'DH',
  Ladakh: 'LA',
  Lakshadweep: 'LD',
});

/** A DataMeet name as { name, code, assembly }: the MLA register's own name for a state with an assembly. */
export function canonicalState(raw) {
  const want = String(raw || '').trim().toLowerCase();
  for (const [name, code, ...aliases] of MLA_STATE_NAMES) {
    if ([name, ...aliases].some((n) => n.toLowerCase() === want)) return { name, code, assembly: true };
  }
  const other = Object.keys(NO_ASSEMBLY).find((n) => n.toLowerCase() === want);
  return other ? { name: other, code: NO_ASSEMBLY[other], assembly: false } : null;
}

/** Polygon records (shape types 5, 15 and 25; only x and y are read) as [{ rings: [[[x, y], …], …] }]. */
export function readShapefile(buffer) {
  if (buffer.length < 100 || buffer.readInt32BE(0) !== 9994) throw new Error('not a shapefile (file code is not 9994)');
  const type = buffer.readInt32LE(32);
  if (![5, 15, 25].includes(type)) throw new Error(`not a polygon shapefile (shape type ${type})`);
  const end = Math.min(buffer.length, buffer.readInt32BE(24) * 2);
  const shapes = [];
  for (let at = 100; at + 8 <= end;) {
    const length = buffer.readInt32BE(at + 4) * 2;
    const c = at + 8;
    const recordType = buffer.readInt32LE(c);
    if (recordType === 0) {
      shapes.push({ rings: [] });
    } else {
      const numParts = buffer.readInt32LE(c + 36);
      const numPoints = buffer.readInt32LE(c + 40);
      const partsAt = c + 44;
      const pointsAt = partsAt + 4 * numParts;
      const starts = Array.from({ length: numParts }, (_v, i) => buffer.readInt32LE(partsAt + 4 * i));
      const rings = starts.map((start, i) => {
        const stop = i + 1 < numParts ? starts[i + 1] : numPoints;
        const ring = [];
        for (let p = start; p < stop; p += 1) ring.push([buffer.readDoubleLE(pointsAt + 16 * p), buffer.readDoubleLE(pointsAt + 16 * p + 8)]);
        return ring;
      });
      shapes.push({ rings });
    }
    at = c + length;
  }
  return shapes;
}

/** A dBASE table's records as plain objects of trimmed strings; deleted records are skipped. */
export function readDbf(buffer) {
  const count = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let at = 32, offset = 1; at + 32 <= headerLength && buffer[at] !== 0x0d; at += 32) {
    const name = buffer.toString('latin1', at, at + 11).replace(/\0.*$/s, '').trim();
    const width = buffer.readUInt8(at + 16);
    fields.push({ name, offset, width });
    offset += width;
  }
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const at = headerLength + i * recordLength;
    if (buffer[at] === 0x2a) continue;
    records.push(Object.fromEntries(fields.map((f) => [f.name, buffer.toString('utf8', at + f.offset, at + f.offset + f.width).trim()])));
  }
  return records;
}

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker: the points of a line that stay further than `tolerance` from the simplified line. */
export function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = -1;
    let far = 0;
    for (let i = first + 1; i < last; i += 1) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst !== -1 && far > tolerance) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_p, i) => keep[i]);
}

const ringArea = (ring) => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return sum + x * ny - nx * y;
}, 0)) / 2;

/** A closed ring split in two so that Douglas–Peucker has two distinct ends to work from. */
function simplifyRing(ring, tolerance) {
  const open = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  if (open.length < 4) return open;
  let farIndex = 0;
  let far = -1;
  for (let i = 1; i < open.length; i += 1) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > far) {
      far = d;
      farIndex = i;
    }
  }
  const a = simplify(open.slice(0, farIndex + 1), tolerance);
  const b = simplify([...open.slice(farIndex), open[0]], tolerance);
  return [...a, ...b.slice(1, -1)];
}

/** Integer points with consecutive repeats removed (the ring is implicitly closed). */
function quantise(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const q = [Math.round(x), Math.round(y)];
    const prev = out.at(-1);
    if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) out.push(q);
  }
  while (out.length > 1 && out[0][0] === out.at(-1)[0] && out[0][1] === out.at(-1)[1]) out.pop();
  return out;
}

const pathOf = (rings) => rings.map((ring) => {
  const deltas = [];
  for (let i = 1; i < ring.length; i += 1) deltas.push(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  return `M${ring[0][0]} ${ring[0][1]}l${deltas.join(' ')}z`;
}).join('');

/**
 * The shipped file from the shapefile's shapes and the table's records (one each, in the same order).
 * Every shape must name a known state or union territory (canonicalState); an unknown name throws.
 */
export function buildStatesGeo({ shapes, records, tolerance = DEFAULT_TOLERANCE, nameField = 'ST_NM' }) {
  if (shapes.length !== records.length) throw new Error(`${shapes.length} shapes but ${records.length} records`);
  let [lon0, lat0, lon1, lat1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const shape of shapes) for (const ring of shape.rings) for (const [lon, lat] of ring) {
    lon0 = Math.min(lon0, lon);
    lon1 = Math.max(lon1, lon);
    lat0 = Math.min(lat0, lat);
    lat1 = Math.max(lat1, lat);
  }
  const ky = UNITS_PER_DEGREE;
  const kx = ky * Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
  const project = ([lon, lat]) => [(lon - lon0) * kx, (lat1 - lat) * ky];
  const states = shapes.map((shape, i) => {
    const raw = records[i]?.[nameField];
    const state = canonicalState(raw);
    if (!state) throw new Error(`unknown state name in the shapefile: ${JSON.stringify(raw)}`);
    const projected = shape.rings.map((ring) => ring.map(project));
    const candidates = projected
      .map((ring) => quantise(simplifyRing(ring, tolerance)))
      .map((ring, k) => ({ ring, area: ringArea(ring), raw: projected[k] }));
    const largest = candidates.reduce((best, c) => (!best || ringArea(c.raw) > ringArea(best.raw) ? c : best), null);
    let rings = candidates.filter((c) => c.ring.length >= 3 && c.area >= MIN_RING_AREA).map((c) => c.ring);
    if (!rings.length && largest) {
      // A state of small islands keeps its largest, unsimplified if simplification flattened it.
      const ring = largest.ring.length >= 3 ? largest.ring : quantise(largest.raw);
      if (ring.length >= 3) rings = [ring];
    }
    return { ...state, d: pathOf(rings) };
  });
  states.sort((a, b) => a.name.localeCompare(b.name));
  const round = (n) => Math.round(n * 1e6) / 1e6;
  return {
    attribution: ATTRIBUTION,
    license: 'CC-BY 2.5 India',
    source: SOURCE,
    boundary: 'Survey of India external boundary as drawn by DataMeet (States/Admin2, Jammu & Kashmir and Ladakh updated to the SOI map in 2021).',
    projection: { type: 'equirectangular', lon0: round(lon0), lat1: round(lat1), kx: round(kx), ky },
    viewBox: [0, 0, Math.ceil((lon1 - lon0) * kx), Math.ceil((lat1 - lat0) * ky)],
    states,
  };
}

function main(argv) {
  const dir = argv.find((a) => !a.startsWith('--'));
  if (!dir) throw new Error('usage: node scripts/build-india-states-geo.mjs <folder with Admin2.shp and Admin2.dbf> [--tolerance n]');
  const t = argv.indexOf('--tolerance');
  const tolerance = t !== -1 ? Number(argv[t + 1]) : DEFAULT_TOLERANCE;
  const shapes = readShapefile(readFileSync(path.join(dir, 'Admin2.shp')));
  const records = readDbf(readFileSync(path.join(dir, 'Admin2.dbf')));
  const geo = buildStatesGeo({ shapes, records, tolerance });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const json = `${JSON.stringify(geo)}\n`;
  writeFileSync(path.join(root, OUT), json);
  console.log(`${OUT}: ${geo.states.length} shapes, ${json.length.toLocaleString('en-IN')} bytes, tolerance ${tolerance}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
