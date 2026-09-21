import { assertEquals } from 'jsr:@std/assert@1';
import { normalise, sha256Hex } from './textNormalise.ts';

const fixture = JSON.parse(
  await Deno.readTextFile(new URL('../../../src/lib/__fixtures__/normalise.json', import.meta.url)),
) as { input: string; normalised: string; sha256: string }[];

Deno.test('normalise collapses whitespace and trims, per the shared fixture', () => {
  for (const c of fixture) assertEquals(normalise(c.input), c.normalised);
});

Deno.test('sha256Hex matches the fixture digests and the abc vector', async () => {
  for (const c of fixture) assertEquals(await sha256Hex(c.normalised), c.sha256);
  assertEquals(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
