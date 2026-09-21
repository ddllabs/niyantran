import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/normalise.json';
import { normalise, sha256Hex } from './textNormalise.js';

describe('textNormalise (client mirror)', () => {
  it('normalises every fixture line exactly as the server does', () => {
    for (const c of fixture) expect(normalise(c.input)).toBe(c.normalised);
  });

  it('hashes to the fixture digests', async () => {
    for (const c of fixture) expect(await sha256Hex(c.normalised)).toBe(c.sha256);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('treats null as empty', () => {
    expect(normalise(null)).toBe('');
  });
});
