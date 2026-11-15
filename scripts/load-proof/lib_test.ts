// The proof database rule (F340): no silent fallback, and the load copy is refused unless it is only read.
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { assertPinned, assertServes, databaseOfUri, LOAD_COPY, pinOf, resolveProofDb } from './lib.ts';

Deno.test('a missing or empty LOAD_PROOF_DB is an error that names the variable', () => {
  for (const v of [undefined, '']) {
    const e = assertThrows(() => resolveProofDb(v), Error);
    assert(e.message.includes('LOAD_PROOF_DB'), e.message);
  }
});

Deno.test('a name that is not a niyantran_ingest_load*_test database is refused', () => {
  for (const bad of ['postgres', 'niyantran_ingest_load_test; drop database x', 'niyantran_ingest_load_Reg_test']) {
    assertThrows(() => resolveProofDb(bad), Error, 'niyantran_ingest_load');
  }
});

Deno.test('the load copy is refused by default and says how to run a reader or override', () => {
  const e = assertThrows(() => resolveProofDb(LOAD_COPY), Error);
  assert(e.message.includes(LOAD_COPY) && e.message.includes('LOAD_PROOF_ALLOW_LOAD_COPY'), e.message);
});

Deno.test('the load copy is allowed to a proof that only reads it, or with the explicit override', () => {
  assertEquals(resolveProofDb(LOAD_COPY, { readOnly: true }), LOAD_COPY);
  assertEquals(resolveProofDb(LOAD_COPY, { allowLoadCopy: '1' }), LOAD_COPY);
  assertThrows(() => resolveProofDb(LOAD_COPY, { allowLoadCopy: 'yes' }), Error);
  assertThrows(() => resolveProofDb(LOAD_COPY, { allowLoadCopy: '' }), Error);
});

Deno.test('any other proof database is returned as named', () => {
  assertEquals(resolveProofDb('niyantran_ingest_load_reg_test'), 'niyantran_ingest_load_reg_test');
  assertEquals(resolveProofDb('niyantran_ingest_load_f340_test'), 'niyantran_ingest_load_f340_test');
});

Deno.test('PostgREST must serve the proof database, whichever proof asks', () => {
  assertServes('niyantran_ingest_load_a_test', 'niyantran_ingest_load_a_test');
  const e = assertThrows(() => assertServes('niyantran_ingest_load_a_test', 'niyantran_ingest_load_test'), Error);
  assert(e.message.includes('niyantran_ingest_load_test') && e.message.includes('niyantran_ingest_load_a_test'));
  assertThrows(() => assertServes('niyantran_ingest_load_a_test', null), Error, 'unreadable');
  assertEquals(databaseOfUri('postgres://r:p@127.0.0.1:5432/d1?x=1'), 'd1');
});

Deno.test('a run pinned to one PostgREST container and database aborts when either changes', () => {
  const a = 'niyantran_ingest_load_a_test';
  const pin = pinOf(a, { id: 'c1', db: a });
  assertPinned(pin, { id: 'c1', db: a });
  assertThrows(() => assertPinned(pin, { id: 'c2', db: a }), Error, 'replaced');
  assertThrows(() => assertPinned(pin, { id: 'c1', db: 'niyantran_ingest_load_b_test' }), Error, 'now serves');
  assertThrows(() => assertPinned(pin, { id: 'c1', db: null }), Error, 'unreadable');
  assertThrows(() => pinOf(a, { id: 'c1', db: 'niyantran_ingest_load_b_test' }), Error, 'serves');
});
