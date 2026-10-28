// F266 step 4.4 (owner, 2026-10-29): a question row's key is its `id`, and 6,845 record links, cached
// briefs and saved chats refer to it. The id must keep naming the same question (answer file plus
// asking member) for as long as the file ships. A re-export that renumbers rows fails here; new
// questions may only be added with ids above the pinned range.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pqAnswerKey } from './pqAnswerKey.js';
import { questionIdentity } from './deskRowSync.js';

const FILE = 'public/data/embedded_csv/national_question_database.json';
const PINNED = { count: 8000, sha256: '028b9562aa62539a358d4a7a87a400de9f16ffe8117173780b5553ff5cfaee88' };

describe('Parliamentary question ids are pinned to their questions (F266)', () => {
  const rows = JSON.parse(readFileSync(FILE, 'utf8'));

  it('every id 1–8000 still names the same answer file and member', () => {
    const pinned = rows.filter((r) => Number(r.id) >= 1 && Number(r.id) <= PINNED.count)
      .sort((a, b) => Number(a.id) - Number(b.id));
    expect(pinned).toHaveLength(PINNED.count);
    const lines = pinned.map((r) => `${r.id}|${pqAnswerKey(r.source_url) || ''}|${r.mp_name}`);
    expect(createHash('sha256').update(lines.join('\n')).digest('hex')).toBe(PINNED.sha256);
  });

  it('ids are unique, each row names one answer file, and answer file plus member is unique', () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    // The pinned range names Lok Sabha answers; rows added above it (Rajya Sabha too) need only a unique id.
    expect(rows.filter((r) => Number(r.id) <= PINNED.count).every((r) => pqAnswerKey(r.source_url))).toBe(true);
    const identities = rows.map((r) => questionIdentity(r)).filter(Boolean);
    expect(new Set(identities).size).toBe(identities.length);
  });

  it('the answer-key rule is the same in the browser, the Edge Function, the planner and SQL', () => {
    const rule = /\^https:\\\/\\\/sansad\\\.in\\\/getFile\\\/loksabhaquestions\\\/annex\\\/\(\[0-9\]\{1,4\}\)\\\/\(\[A-Za-z0-9_\]\{1,64\}\)\\\.pdf\(\\\?source=pqals\)\?\$/;
    for (const f of ['src/lib/pqAnswerKey.js', 'supabase/functions/_shared/suppliedText.ts', 'scripts/record-mapping-repair.mjs']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(rule);
    }
    expect(readFileSync('supabase/migrations/20261028130000_pq_admission_links.sql', 'utf8'))
      .toContain(String.raw`'^https://sansad\.in/getFile/loksabhaquestions/annex/([0-9]{1,4})/([A-Za-z0-9_]{1,64})\.pdf(\?source=pqals)?$'`);
  });
});
