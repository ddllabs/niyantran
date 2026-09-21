import { assert, assertEquals, assertMatch, assertThrows } from 'jsr:@std/assert@1';
import { createHandleAssigner, HANDLE_RE, handlesIn, randomNonce } from './handles.ts';

Deno.test('handles are ref:<nonce>-<n>, idempotent per key, resolvable, in order', () => {
  const a = createHandleAssigner('ab12cd');
  assertEquals(a.assign('chunk-1'), 'ref:ab12cd-1');
  assertEquals(a.assign('row-x'), 'ref:ab12cd-2');
  assertEquals(a.assign('chunk-1'), 'ref:ab12cd-1', 'same key, same handle');
  assertEquals(a.lookup('ref:ab12cd-2'), 'row-x');
  assertEquals(a.lookup('ref:zzzzzz-1'), undefined);
  assertEquals(Object.keys(a.handles()), ['ref:ab12cd-1', 'ref:ab12cd-2']);
  assertEquals(a.size(), 2);
});

Deno.test('a fresh assigner draws a fresh nonce; 1,000 draws never repeat', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const n = randomNonce();
    assertMatch(n, /^[a-z0-9]{6}$/);
    assert(!seen.has(n), `nonce ${n} repeated`);
    seen.add(n);
  }
  assertThrows(() => createHandleAssigner('BAD'), Error, 'six of');
});

Deno.test('HANDLE_RE matches handles in prose and never a bracketed marker', () => {
  const text = 'See ref:ab12cd-3 and ref:ab12cd-12, not [3] or [12] or ref:AB12CD-1.';
  assertEquals(handlesIn(text), ['ref:ab12cd-3', 'ref:ab12cd-12']);
  assertEquals('[1] [2, 3]'.match(HANDLE_RE), null);
});

Deno.test('handle discovery rejects embedded prefixes and forged suffixes without shortening numeric handles', () => {
  const forged = [
    'prefixref:abc123-1', 'prefix-ref:abc123-1', 'prefix_ref:abc123-1', 'prefix:ref:abc123-1',
    'हref:abc123-1', 'ref:abc123-1forged', 'ref:abc123-1_forged',
    'ref:abc123-1-forged', 'ref:abc123-1ह', 'ref:abc123-1\u0301',
    '[ref:abc123-1forged]',
  ];
  for (const token of forged) assertEquals(handlesIn(token), [], token);
  assertEquals(handlesIn('ref:abc123-10 ref:abc123-1 ref:abc123-10'), ['ref:abc123-10', 'ref:abc123-1']);
});

Deno.test('handle discovery preserves bare/bracketed handles beside prose punctuation', () => {
  const text = 'ref:abc123-1, (ref:abc123-10); [ref:abc123-12]! claim[ref:abc123-2]. ref:abc123-3: details — ref:abc123-4?';
  assertEquals(handlesIn(text), ['ref:abc123-1', 'ref:abc123-10', 'ref:abc123-12', 'ref:abc123-2', 'ref:abc123-3', 'ref:abc123-4']);
});
