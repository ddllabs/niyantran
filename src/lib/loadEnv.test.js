// loadEnv reads only this app's env files. `nter/.env` belonged to the old
// ddllabs/NTER layout, where a sibling app's secrets could leak into this
// server's process.env (backlog: "loadEnv still reads nter/.env").
import fs from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../server/loadEnv.mjs';

afterEach(() => vi.restoreAllMocks());

describe('loadEnv', () => {
  it('looks only at the app env files', () => {
    const probed = [];
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => { probed.push(String(p).replace(/\\/g, '/')); return false; });
    loadEnv(true);
    expect(probed.map((p) => p.split('/').slice(-2).join('/')).slice(2)).toEqual(['backend/.env']);
    expect(probed).toHaveLength(3);
    expect(probed.some((p) => p.includes('/nter/'))).toBe(false);
  });
});
