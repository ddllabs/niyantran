import { assertEquals } from 'jsr:@std/assert@1';
import { LEDGER_MAX_BYTES, LEDGER_MAX_ENTRIES, ledgerFromInput, mergeLedger } from './ledger.ts';

const entry = (name: string, note = 'a note') => ({ name, kind: 'person', note });

Deno.test('null and absent ledgers start empty; a good ledger round-trips; junk is rejected', () => {
  assertEquals(ledgerFromInput(null), { entries: [] });
  assertEquals(ledgerFromInput(undefined), { entries: [] });
  assertEquals(ledgerFromInput({ entries: [entry('A')] }), { entries: [entry('A')] });
  for (
    const bad of ['x', 5, [], { entries: 'no' }, { entries: [{ name: 1, kind: 'p', note: 'n' }] }, {
      entries: [{ name: 'a' }],
    }, { entries: [null] }]
  ) {
    assertEquals(ledgerFromInput(bad), undefined, JSON.stringify(bad));
  }
});

Deno.test('an input ledger over 4 kB is rejected', () => {
  const big = { entries: Array.from({ length: 30 }, (_, i) => entry(`P${i}`, 'x'.repeat(250))) };
  assertEquals(new TextEncoder().encode(JSON.stringify(big)).length > LEDGER_MAX_BYTES, true);
  assertEquals(ledgerFromInput(big), undefined);
});

Deno.test('updates replace an entry of the same name (any case) and move it to the most recent end', () => {
  const merged = mergeLedger({ entries: [entry('Amit Shah', 'old'), entry('Delhi')] }, [{
    name: 'amit shah',
    kind: 'person',
    note: 'Home Minister',
  }]);
  assertEquals(merged.entries.map((e) => e.name), ['Delhi', 'amit shah']);
  assertEquals(merged.entries[1].note, 'Home Minister');
});

Deno.test('the ledger keeps its 30 most recent entries', () => {
  const start = { entries: Array.from({ length: 25 }, (_, i) => entry(`Old${i}`)) };
  const merged = mergeLedger(start, Array.from({ length: 15 }, (_, i) => entry(`New${i}`)));
  assertEquals(merged.entries.length, LEDGER_MAX_ENTRIES);
  assertEquals(merged.entries[0].name, 'Old10');
  assertEquals(merged.entries.at(-1)!.name, 'New14');
});

Deno.test('the ledger is trimmed from the oldest end to fit 4 kB, so it round-trips', () => {
  const updates = Array.from({ length: 20 }, (_, i) => entry(`Person${i}`, 'é'.repeat(290)));
  const merged = mergeLedger({ entries: [] }, updates);
  assertEquals(new TextEncoder().encode(JSON.stringify(merged)).length <= LEDGER_MAX_BYTES, true);
  assertEquals(merged.entries.at(-1)!.name, 'Person19');
  assertEquals(ledgerFromInput(merged) !== undefined, true);
});

Deno.test('update fields are clipped and an unknown kind becomes other', () => {
  const merged = mergeLedger({ entries: [] }, [{ name: 'n'.repeat(500), kind: 'wizard', note: 'z'.repeat(900) }]);
  assertEquals(merged.entries[0].name.length <= 100, true);
  assertEquals(merged.entries[0].note.length <= 300, true);
  assertEquals(merged.entries[0].kind, 'other');
});
