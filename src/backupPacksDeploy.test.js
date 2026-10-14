import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../api/router.js';
import { loadBackupForFeature } from '../server/backupFeed.mjs';

// F156 (owner, 2026-10-14): the live function carries only the four backup packs that fill modules
// otherwise empty on the live site, plus their desks' manifests, not all 82 MB of backup/.
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const deployed = vercel.functions['api/router.js'].includeFiles;
const listed = deployed.replace(/^\{|\}$/g, '').split(',');
const backupFiles = listed.filter((p) => p.startsWith('backup/'));

const FOUR = [
  ['Satellite Infrastructure', 'global'],
  ['Growth Indicators', 'global'],
  ['Global Trade', 'global'],
  ['Athlete Index', 'sports'],
];

describe('backup packs on the live function', () => {
  it('lists the same files in vercel.json and the router config', () => {
    expect(config.includeFiles).toEqual([deployed]);
  });

  it('carries the four packs and their manifests by name, never the whole folder', () => {
    expect(backupFiles).toHaveLength(6);
    expect(backupFiles.every((p) => !p.includes('*'))).toBe(true);
    for (const p of backupFiles) expect(existsSync(new URL(`../${p}`, import.meta.url)), p).toBe(true);
  });

  it.each(FOUR)('finds stored rows for %s in a listed pack', (feature, tier) => {
    const pack = loadBackupForFeature(feature, tier, { cap: 5 });
    expect(pack?.rows?.length, feature).toBeGreaterThan(0);
    const file = backupFiles.find((p) => p.endsWith('.xlsx') && p.includes(feature.replace(/ /g, '_')));
    expect(file, feature).toBeTruthy();
  });
});
