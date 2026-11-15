// The driver's failure bookkeeping (review findings S2, B6). Those tests need PostgREST up and LOAD_PROOF_DB set to the
// database it serves; they are skipped otherwise. The refusal tests at the end need neither.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { POSTGREST, ProofRefused } from './lib.ts';
import { keepEvidence } from './evidence.ts';
import { drain, type Harness, makeHarness } from './driver.ts';

const up = await new Deno.Command('docker', {
  args: ['inspect', '-f', '{{.State.Running}}', POSTGREST],
  env: { PATH: `${Deno.env.get('HOME')}/.docker/bin:${Deno.env.get('PATH')}` },
  stdout: 'piped',
  stderr: 'null',
}).output().then((o) => new TextDecoder().decode(o.stdout).trim() === 'true', () => false) &&
  !!Deno.env.get('LOAD_PROOF_DB');

Deno.test({
  name: 'claim and settings failures reported by the worker are recorded as failures',
  ignore: !up,
  async fn() {
    const h = await makeHarness();
    try {
      const { deps } = h.workerDeps();
      deps.log('worker.claim_failed', { message: 'x' });
      deps.log('worker.settings_failed', { message: 'y' });
      deps.log('worker.idle', {});
      assertEquals(h.events.failures.map((f) => f.event), ['worker.claim_failed', 'worker.settings_failed']);
    } finally {
      h.close();
    }
  },
});

Deno.test({
  name: 'a drain refuses fewer than one worker instead of looping forever',
  ignore: !up,
  async fn() {
    const h = await makeHarness();
    try {
      await assertRejects(() => drain(h, { concurrency: 0 }), Error, 'at least 1');
    } finally {
      h.close();
    }
  },
});

// ─── refusals: no database needed ────────────────────────────────────────────

const WIRE_DB = 'niyantran_ingest_load_wire_test';

Deno.test('makeHarness refuses a database whose last failure has not been inspected, before touching PostgREST', async () => {
  const home = await Deno.makeTempDir({ prefix: 'driver-test-' });
  try {
    await keepEvidence({ home, db: WIRE_DB, proof: 'p', reason: 'r', files: {}, query: () => Promise.resolve('[]') });
    await assertRejects(() => makeHarness({ home, db: WIRE_DB }), ProofRefused, 'not been inspected');
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test('makeHarness refuses when PostgREST does not serve the proof database', async () => {
  const home = await Deno.makeTempDir({ prefix: 'driver-test-' });
  try {
    // No marker here, so the refusal can only come from the served-database check.
    await assertRejects(() => makeHarness({ home, db: WIRE_DB }), Error, 'PostgREST');
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test('a drain re-checks PostgREST before it runs anything, and aborts when the check fails', async () => {
  let checks = 0;
  const h = {
    recheck: () => {
      checks++;
      return Promise.reject(new Error('PostgREST now serves another database'));
    },
  } as unknown as Harness;
  await assertRejects(() => drain(h, { concurrency: 1 }), Error, 'PostgREST now serves');
  assertEquals(checks, 1);
});
