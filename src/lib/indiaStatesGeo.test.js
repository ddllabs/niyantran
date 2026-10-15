// F196 Party Organisation Map: the India state shapes the map draws. scripts/build-india-states-geo.mjs
// turns DataMeet's States/Admin2 shapefile (CC-BY 2.5 India; downloaded 2026-10-15 with the owner's
// approval, not kept in the repository) into src/data/india-states-geo.json. These tests cover the
// script's readers and simplification on small synthetic files, and the shipped file itself: its size,
// its attribution, a shape for every state with an assembly, and the official external boundary.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildStatesGeo, readDbf, readShapefile, simplify } from '../../scripts/build-india-states-geo.mjs';
import { MLA_STATES } from './mlaStates.js';
import geo from '../data/india-states-geo.json';

const GEO_PATH = new URL('../data/india-states-geo.json', import.meta.url);

/** A polygon shapefile (type 5) with one record per entry of `shapes` (each a list of rings). */
function shpOf(shapes) {
  const records = shapes.map((rings) => {
    const points = rings.flat();
    const content = Buffer.alloc(44 + 4 * rings.length + 16 * points.length);
    content.writeInt32LE(5, 0);
    content.writeInt32LE(rings.length, 36);
    content.writeInt32LE(points.length, 40);
    let at = 0;
    rings.forEach((ring, i) => {
      content.writeInt32LE(at, 44 + 4 * i);
      at += ring.length;
    });
    points.forEach(([x, y], i) => {
      content.writeDoubleLE(x, 44 + 4 * rings.length + 16 * i);
      content.writeDoubleLE(y, 44 + 4 * rings.length + 16 * i + 8);
    });
    return content;
  });
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(5, 32);
  const parts = [header];
  records.forEach((content, i) => {
    const head = Buffer.alloc(8);
    head.writeInt32BE(i + 1, 0);
    head.writeInt32BE(content.length / 2, 4);
    parts.push(head, content);
  });
  const file = Buffer.concat(parts);
  file.writeInt32BE(file.length / 2, 24);
  return file;
}

/** A dBASE III file with one character field of width 20. */
function dbfOf(field, values) {
  const header = Buffer.alloc(32 + 32 + 1);
  header.writeUInt8(3, 0);
  header.writeUInt32LE(values.length, 4);
  header.writeUInt16LE(header.length, 8);
  header.writeUInt16LE(21, 10);
  header.write(field, 32, 'latin1');
  header.write('C', 32 + 11, 'latin1');
  header.writeUInt8(20, 32 + 16);
  header.writeUInt8(0x0d, 64);
  const rows = values.map((v) => Buffer.from(` ${String(v).padEnd(20, ' ')}`, 'latin1'));
  return Buffer.concat([header, ...rows, Buffer.from([0x1a])]);
}

/** The rings of a shipped path ("M x y l dx dy … z", integers), in the file's projected units. */
function decodePath(d) {
  const rings = [];
  for (const part of d.split('M').filter(Boolean)) {
    const nums = part.replace(/[lz]/g, ' ').trim().split(/[\s,]+|(?=-)/).filter(Boolean).map(Number);
    let x = nums[0];
    let y = nums[1];
    const ring = [[x, y]];
    for (let i = 2; i + 1 < nums.length; i += 2) {
      x += nums[i];
      y += nums[i + 1];
      ring.push([x, y]);
    }
    rings.push(ring);
  }
  return rings;
}

const toLonLat = ([x, y]) => [x / geo.projection.kx + geo.projection.lon0, geo.projection.lat1 - y / geo.projection.ky];

function inside(rings, [lon, lat]) {
  let hit = false;
  for (const ring of rings) {
    const pts = ring.map(toLonLat);
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

const shape = (name) => geo.states.find((s) => s.name === name);

describe('the shapefile readers', () => {
  it('reads every ring of every polygon record, in record order', () => {
    const square = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    const hole = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]];
    const island = [[5, 5], [5, 6], [6, 6], [5, 5]];
    const shapes = readShapefile(shpOf([[square, hole], [island]]));
    expect(shapes).toHaveLength(2);
    expect(shapes[0].rings).toEqual([square, hole]);
    expect(shapes[1].rings).toEqual([island]);
  });

  it('refuses a file that is not a polygon shapefile', () => {
    const file = shpOf([[[[0, 0], [1, 1], [0, 0]]]]);
    file.writeInt32BE(1234, 0);
    expect(() => readShapefile(file)).toThrow(/not a shapefile/);
  });

  it('reads the dBASE table with each value trimmed', () => {
    expect(readDbf(dbfOf('ST_NM', ['Kerala', 'Jammu & Kashmir']))).toEqual([{ ST_NM: 'Kerala' }, { ST_NM: 'Jammu & Kashmir' }]);
  });
});

describe('simplification', () => {
  it('drops points within the tolerance of the line and keeps both ends and the corners', () => {
    const line = [[0, 0], [1, 0.01], [2, -0.01], [3, 0], [3, 3]];
    expect(simplify(line, 0.1)).toEqual([[0, 0], [3, 0], [3, 3]]);
    expect(simplify(line, 0.001)).toEqual(line);
  });
});

describe('buildStatesGeo', () => {
  const square = (x, y, s) => [[x, y], [x, y + s], [x + s, y + s], [x + s, y], [x, y]];
  const built = buildStatesGeo({
    shapes: [{ rings: [square(75, 20, 2)] }, { rings: [square(80, 30, 1), square(85, 25, 0.0001)] }],
    records: [{ ST_NM: 'Odisha' }, { ST_NM: 'Ladakh' }],
  });

  it('names each shape by the canonical state list, with its code and whether it has an assembly', () => {
    expect(built.states.map(({ name, code, assembly }) => ({ name, code, assembly }))).toEqual([
      { name: 'Ladakh', code: 'LA', assembly: false },
      { name: 'Odisha', code: 'OD', assembly: true },
    ]);
  });

  it('writes integer relative paths and drops rings too small to draw', () => {
    const ladakh = built.states.find((s) => s.name === 'Ladakh');
    expect(ladakh.d).toMatch(/^M\d+ \d+l[-\d ]+z$/);
    expect(decodePath(ladakh.d)).toHaveLength(1);
  });

  it('carries the attribution and the projection needed to read the paths back', () => {
    expect(built.attribution).toBe('Map data: DataMeet (CC-BY 2.5 India)');
    expect(built.projection).toEqual(expect.objectContaining({ lon0: expect.any(Number), lat1: expect.any(Number), kx: expect.any(Number), ky: expect.any(Number) }));
  });

  it('refuses a shape whose name it does not know rather than guessing', () => {
    expect(() => buildStatesGeo({ shapes: [{ rings: [square(75, 20, 2)] }], records: [{ ST_NM: 'Atlantis' }] })).toThrow(/Atlantis/);
  });
});

describe('the shipped India state shapes', () => {
  it('stays within the size budget', () => {
    const bytes = statSync(GEO_PATH).size;
    expect(bytes).toBeGreaterThan(30_000); // below this the coast and borders lose visible detail
    expect(bytes).toBeLessThanOrEqual(400_000);
  });

  it('credits DataMeet in the file', () => {
    expect(geo.attribution).toBe('Map data: DataMeet (CC-BY 2.5 India)');
    expect(geo.source).toMatch(/datameet\/maps/);
    expect(JSON.parse(readFileSync(GEO_PATH, 'utf8')).license).toBe('CC-BY 2.5 India');
  });

  it('has a shape for every state and union territory in the MLA register, and five without an assembly', () => {
    const names = geo.states.map((s) => s.name);
    for (const state of MLA_STATES) expect(names).toContain(state);
    expect(geo.states).toHaveLength(36);
    expect(geo.states.filter((s) => !s.assembly).map((s) => s.name).sort()).toEqual(
      ['Andaman & Nicobar', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Ladakh', 'Lakshadweep'],
    );
    for (const s of geo.states) expect(decodePath(s.d).length).toBeGreaterThan(0);
  });

  it('follows the official external boundary in Jammu & Kashmir, Ladakh and Arunachal Pradesh', () => {
    const jk = decodePath(shape('Jammu & Kashmir').d);
    const ladakh = decodePath(shape('Ladakh').d);
    // Muzaffarabad and Mirpur are in Jammu & Kashmir on the Survey of India map.
    expect(inside(jk, [73.47, 34.37])).toBe(true);
    expect(inside(jk, [73.75, 33.15])).toBe(true);
    // Gilgit, Skardu, the Siachen glacier, the Shaksgam valley and Aksai Chin are in Ladakh.
    for (const point of [[74.31, 35.92], [75.63, 35.3], [77.1, 35.4], [76.5, 36.1], [79.5, 35.2]]) expect(inside(ladakh, point)).toBe(true);
    // The northernmost point is near 37°05' N.
    const north = Math.max(...ladakh.flat().map((p) => toLonLat(p)[1]));
    expect(north).toBeGreaterThan(37.0);
    expect(north).toBeLessThan(37.2);
    // Tawang is in Arunachal Pradesh.
    expect(inside(decodePath(shape('Arunachal Pradesh').d), [91.86, 27.59])).toBe(true);
  });
});
