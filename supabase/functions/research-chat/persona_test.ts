import { assertEquals } from 'jsr:@std/assert@1';
import { resolvePersona } from './persona.ts';

// The admin persona probe (docs/plans/2026-09-28-remaining-work.md, C4): an
// admin may ask for a persona by name to test it; everyone else, and every
// failure, gets the caller's own saved persona, as before.
function sources({ own = 'upsc_aspirant' as string | null, admin = false, adminFails = false } = {}) {
  const read: string[] = [];
  return {
    read,
    s: {
      profilePersona: () => Promise.resolve(own),
      isAdmin: () => (adminFails ? Promise.reject(new Error('rpc down')) : Promise.resolve(admin)),
      readPersona: (file: string) => {
        read.push(file);
        return Promise.resolve(`prompt:${file}`);
      },
    },
  };
}

Deno.test('an admin probe uses the named persona', async () => {
  const { s, read } = sources({ admin: true });
  assertEquals(await resolvePersona('journalist', s), 'prompt:journalist.md');
  assertEquals(read, ['journalist.md']);
});

Deno.test("a non-admin's probe is ignored: their own persona answers", async () => {
  const { s } = sources({ admin: false });
  assertEquals(await resolvePersona('journalist', s), 'prompt:student.md');
});

Deno.test('a failed admin check falls back to the own persona', async () => {
  const { s } = sources({ adminFails: true });
  assertEquals(await resolvePersona('journalist', s), 'prompt:student.md');
});

Deno.test('an unknown probe is ignored, and no persona falls back to analyst.md', async () => {
  assertEquals(await resolvePersona('hacker', sources({ admin: true }).s), 'prompt:student.md');
  assertEquals(await resolvePersona(undefined, sources({ own: null }).s), 'prompt:analyst.md');
});

Deno.test('without a probe the admin check is not even asked', async () => {
  let asked = false;
  const { s } = sources();
  await resolvePersona(undefined, { ...s, isAdmin: () => { asked = true; return Promise.resolve(true); } });
  assertEquals(asked, false);
});
