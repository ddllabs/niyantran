import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { manifestLine, manifestSha256 } from './batchManifest.js';

// The same five items and the same hash are asserted by supabase/tests/ingest_register_batch.sql
// against ingest_batch_manifest_sha256, so the runner and the database are held to one definition.
const VECTOR = [
  { source_key: 'law:é', payload_sha256: 'a'.repeat(64), content_sha256: 'b'.repeat(64), chunks: 3, est_tokens: 40 },
  { source_key: 'law:b', payload_sha256: 'c'.repeat(64), content_sha256: 'd'.repeat(64), chunks: 1, est_tokens: 0 },
  { source_key: 'Law:Z', payload_sha256: 'e'.repeat(64), content_sha256: 'f'.repeat(64), chunks: 800, est_tokens: 12345 },
  { source_key: 'law:\u{1F600}', payload_sha256: '1'.repeat(64), content_sha256: '2'.repeat(64), chunks: 2, est_tokens: 7 },
  { source_key: 'law:Ａ', payload_sha256: '3'.repeat(64), content_sha256: '4'.repeat(64), chunks: 2, est_tokens: 7 },
];
const VECTOR_SHA256 = '06910be15a15ab724eb843bc55e62251dbe7e24879ee6293838ca10f89310a8a';

describe('batch manifest hash', () => {
  it('matches the vector the SQL fixture checks', async () => {
    expect(await manifestSha256(VECTOR)).toBe(VECTOR_SHA256);
  });

  it('sorts by UTF-8 bytes (collate "C"), not by UTF-16 code units', async () => {
    // U+FF21 (EF BC A1) sorts before U+1F600 (F0 9F 98 80) in bytes; a UTF-16 sort puts the emoji's
    // surrogate (D83D) first.
    const byBytes = ['Law:Z', 'law:b', 'law:é', 'law:Ａ', 'law:\u{1F600}'];
    const text = byBytes.map((k) => manifestLine(VECTOR.find((i) => i.source_key === k))).join('');
    expect(crypto.createHash('sha256').update(text, 'utf8').digest('hex')).toBe(VECTOR_SHA256);
    const byUnits = [...VECTOR].sort((a, b) => (a.source_key < b.source_key ? -1 : 1)).map(manifestLine).join('');
    expect(crypto.createHash('sha256').update(byUnits, 'utf8').digest('hex')).not.toBe(VECTOR_SHA256);
  });

  it('does not depend on the input order', async () => {
    expect(await manifestSha256([...VECTOR].reverse())).toBe(VECTOR_SHA256);
  });

  it('refuses what the database refuses', async () => {
    const ok = VECTOR[1];
    expect(() => manifestLine({ ...ok, source_key: 'a\tb' })).toThrow(/control codes/);
    expect(() => manifestLine({ ...ok, source_key: '' })).toThrow(/source_key/);
    expect(() => manifestLine({ ...ok, payload_sha256: 'A'.repeat(64) })).toThrow(/hex/);
    expect(() => manifestLine({ ...ok, chunks: 0 })).toThrow(/chunks/);
    expect(() => manifestLine({ ...ok, chunks: 801 })).toThrow(/chunks/);
    expect(() => manifestLine({ ...ok, est_tokens: -1 })).toThrow(/est_tokens/);
    expect(() => manifestLine({ ...ok, est_tokens: 1.5 })).toThrow(/est_tokens/);
    await expect(manifestSha256([ok, { ...ok }])).rejects.toThrow(/twice/);
  });
});
