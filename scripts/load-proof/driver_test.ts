// The driver's failure bookkeeping (review findings S2, B6). Needs PostgREST up; skipped when it is not.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { POSTGREST } from './lib.ts';
import { drain, makeHarness } from './driver.ts';

const up = await new Deno.Command('docker', {
  args: ['inspect', '-f', '{{.State.Running}}', POSTGREST],
  env: { PATH: `${Deno.env.get('HOME')}/.docker/bin:${Deno.env.get('PATH')}` },
  stdout: 'piped',
  stderr: 'null',
}).output().then((o) => new TextDecoder().decode(o.stdout).trim() === 'true', () => false);

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
