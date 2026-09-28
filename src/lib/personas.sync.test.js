/**
 * The edge functions read persona prompts from supabase/functions/_shared/personas/,
 * a generated copy of src/data/personas/. Regenerate with `node scripts/sync-personas.mjs`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSONA_MAP } from './personaMap.js';

const SRC = resolve(__dirname, '../data/personas');
const DST = resolve(__dirname, '../../supabase/functions/_shared/personas');

describe('persona prompts are synced to the edge functions', () => {
  it('same file list, same bytes', () => {
    const src = readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();
    const dst = readdirSync(DST).filter((f) => f.endsWith('.md')).sort();
    expect(dst, 'file list').toEqual(src);
    for (const f of src) {
      expect(readFileSync(resolve(DST, f), 'utf8'), `${f} differs; run node scripts/sync-personas.mjs`).toBe(readFileSync(resolve(SRC, f), 'utf8'));
    }
  });

  // Academic borrowed the UPSC exam prompt, so an academic account got
  // GS-paper answers. It now has its own research prompt.
  it('academic has its own prompt, distinct from the UPSC one', () => {
    const academic = PERSONA_MAP.find((p) => p.db === 'academic');
    expect(academic.prompt).toBe('academic.md');
    expect(readFileSync(resolve(SRC, 'academic.md'), 'utf8')).not.toBe(readFileSync(resolve(SRC, 'student.md'), 'utf8'));
  });

  it('every persona map entry points at a shipped file', () => {
    const files = new Set(readdirSync(SRC).filter((f) => f.endsWith('.md')));
    for (const p of PERSONA_MAP) expect(files.has(p.prompt), `${p.db} → ${p.prompt}`).toBe(true);
  });
});
