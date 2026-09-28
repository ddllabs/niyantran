// The home endpoints cache their last good markets, news and conflict
// payloads. That cache used to overwrite the committed seeds in public/data,
// so every `npm test` and every local dev session left protected data files
// modified. The cache now lives under writablePath('home-snapshots'); the
// committed files are read-only seeds.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { serveHomeLatest, serveHomeMarkets, serveHomePulse } from '../../server/homeApi.mjs';

const PUBLIC_DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/data');

function digest() {
  const out = {};
  for (const name of fs.readdirSync(PUBLIC_DATA)) {
    const file = path.join(PUBLIC_DATA, name);
    if (fs.statSync(file).isFile()) out[name] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return out;
}

describe('home snapshot cache', () => {
  it('never writes into public/data', async () => {
    const before = digest();
    await serveHomeMarkets({ fresh: true });
    await serveHomeLatest({ fresh: true });
    await serveHomePulse({ fresh: true });
    expect(digest()).toEqual(before);
  }, 60_000);
});
