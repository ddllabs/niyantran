// F340 and F305 are only worth something if the proofs call them. These tests read the sources and fail when a guard is
// unplugged (a proof that no longer checks which database PostgREST serves, or no longer keeps evidence). They are
// deliberately crude: the behaviour of each guard is tested beside it; this only proves it is still connected.
import { assert } from 'jsr:@std/assert@1';

const read = (name: string) => Deno.readTextFile(new URL(name, import.meta.url));

/** The source of `name` from the line containing `from` to the end of that function's first closing brace at column 0. */
function section(src: string, from: string): string {
  const a = src.indexOf(from);
  assert(a >= 0, `${from} is missing`);
  const b = src.indexOf('\n}\n', a);
  return src.slice(a, b < 0 ? undefined : b);
}

Deno.test('every harness checks the pending failure and the served database, and a drain re-checks it', async () => {
  const d = await read('driver.ts');
  const pre = section(d, 'export async function preflight');
  assert(pre.includes('pendingFailureMessage('), 'preflight no longer refuses an uninspected failure');
  assert(pre.includes('pinPostgrest('), 'preflight no longer checks which database PostgREST serves');
  assert(section(d, 'export async function makeHarness').includes('preflight('), 'makeHarness no longer runs preflight');
  assert(section(d, 'export async function drain').includes('h.recheck()'), 'drain no longer re-checks PostgREST');
  assert(d.includes('recheck: () => recheckPostgrest(pin)'), 'the harness no longer re-checks against its pin');
});

Deno.test('the bulk proof re-checks before each runner call and keeps evidence on every kind of failure', async () => {
  const b = await read('bulk-proof.ts');
  assert((b.match(/await h\.recheck\(\);[^\n]*\n\s*const \w+ = await run\(/g) ?? []).length === 3, 'a runner call lost its re-check');
  assert(b.includes('shouldKeepEvidence(code, broken)') && b.includes('keepAfterThrow('), 'bulk-proof keeps no evidence');
  assert(b.includes('keepEvidence({') && b.includes('code = await main()'), 'bulk-proof no longer wraps main()');
  assert(b.includes('unexpected error: ${errorLabel(thrown)}'), 'bulk-proof puts error text in the marker');
});

Deno.test('the Regulatory proof checks the pin, re-checks before the runner and keeps evidence', async () => {
  const r = await read('regulatory-proof.ts');
  assert(section(r, 'async function requireRehearsalDatabase').includes('pendingFailureMessage('), 'no pending-failure refusal');
  assert(section(r, 'async function requireRehearsalDatabase').includes('pinOf('), 'no served-database check');
  assert(r.includes('assertPinned(pin, h.pin)'), 'the harness pin is no longer compared with the start pin');
  assert(/await h\.recheck\(\);[^\n]*\n\s*return main\(/.test(r), 'the runner call lost its re-check');
  assert(r.includes('keepAfterThrow({ refusal: notReady, wrote: wroteToDb })'), 'a thrown failure after writes keeps no evidence');
  assert(!/keepFailureEvidence\([^)]*message\(e\)/.test(r), 'the Regulatory proof puts error text in the marker');
});

Deno.test('the database shell scripts refuse a reset or drop while a failure is uninspected, and db.sh can clear it', async () => {
  const db = await read('db.sh');
  assert(db.includes('refuse_unless_inspected "$DB" replace') && db.includes('refuse_unless_inspected "$DB" drop'), 'db.sh');
  assert(db.includes('inspected) mark_inspected "$DB"'), 'db.sh has no inspected command');
  const reg = await read('regulatory-setup.sh');
  assert(reg.includes('refuse_unless_inspected "$DB" reset') && reg.includes('refuse_unless_inspected "$DB" drop'), 'setup');
  assert(reg.includes('inspected) mark_inspected "$DB"'), 'regulatory-setup.sh has no inspected command');
  assert((await read('guard.sh')).includes('inspected_command "$db"'), 'the refusal no longer names the right command');
});

Deno.test('e1 runs its pre-flight outside the try that restores the worker settings', async () => {
  const e = await read('e1.ts');
  const fn = section(e, 'async function runCase');
  assert(fn.indexOf('await preflight()') >= 0 && fn.indexOf('await preflight()') < fn.indexOf('try {'), 'e1 runCase');
});
