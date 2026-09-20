import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dbPersona, frontendPersona, PERSONA_MAP } from './personaMap.js';

describe('personaMap', () => {
  it('maps every db persona to one frontend id and back', () => {
    for (const p of PERSONA_MAP) {
      expect(frontendPersona(p.db)).toBe(p.frontend);
      expect(dbPersona(p.frontend)).toBe(p.db);
    }
    expect(new Set(PERSONA_MAP.map((p) => p.db)).size).toBe(PERSONA_MAP.length);
    expect(new Set(PERSONA_MAP.map((p) => p.frontend)).size).toBe(PERSONA_MAP.length);
  });

  it('returns null for unknown ids rather than a default', () => {
    expect(dbPersona('gov')).toBeNull();
    expect(frontendPersona('owner')).toBeNull();
    expect(dbPersona(undefined)).toBeNull();
  });

  it('matches the edge-function twin row for row', () => {
    const twin = readFileSync(new URL('../../supabase/functions/_shared/personaMap.ts', import.meta.url), 'utf8');
    for (const p of PERSONA_MAP) {
      expect(twin).toContain(`{ db: '${p.db}', frontend: '${p.frontend}', prompt: '${p.prompt}' }`);
    }
    expect((twin.match(/\{ db: '/g) || []).length).toBe(PERSONA_MAP.length);
  });
});
