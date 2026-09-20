import { assertEquals } from 'jsr:@std/assert@1';
import { dbPersona, frontendPersona, PERSONA_MAP, promptFile } from './personaMap.ts';

Deno.test('every db persona maps to one frontend id and back', () => {
  for (const p of PERSONA_MAP) {
    assertEquals(frontendPersona(p.db), p.frontend);
    assertEquals(dbPersona(p.frontend), p.db);
  }
  assertEquals(new Set(PERSONA_MAP.map((p) => p.db)).size, PERSONA_MAP.length);
  assertEquals(new Set(PERSONA_MAP.map((p) => p.frontend)).size, PERSONA_MAP.length);
});

Deno.test('unknown ids resolve to null, never to a default persona', () => {
  assertEquals(dbPersona('gov'), null);
  assertEquals(frontendPersona('owner'), null);
  assertEquals(dbPersona(undefined), null);
});

Deno.test('academic borrows the student prompt until academic.md exists', () => {
  assertEquals(promptFile('academic'), 'student.md');
  assertEquals(promptFile('policy_analyst'), 'policy.md');
});
