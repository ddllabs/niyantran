// The stop rule's look at the database log. These read the real container's log, because the failure they
// guard against is in how Docker returns that log: on this container `docker logs --since` returns nothing,
// so a check built on it reports "no trouble" for ever. Needs niyantran-corpus-test-db; skipped without it.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { CONTAINER, dbLogTrouble, isLogTrouble } from './lib.ts';

const env = { PATH: `${Deno.env.get('HOME')}/.docker/bin:${Deno.env.get('PATH')}` };
const up = await new Deno.Command('docker', {
  args: ['inspect', '-f', '{{.State.Running}}', CONTAINER],
  env,
  stdout: 'piped',
  stderr: 'null',
}).output().then((o) => new TextDecoder().decode(o.stdout).trim() === 'true', () => false);

Deno.test({
  name: 'a real statement timeout written to the log is found',
  ignore: !up,
  async fn() {
    const since = new Date(Date.now() - 1000).toISOString();
    await new Deno.Command('docker', {
      args: ['exec', CONTAINER, 'psql', '-U', 'postgres', '-c', 'set statement_timeout = 1', '-c', 'select pg_sleep(1)'],
      env,
      stdout: 'null',
      stderr: 'null',
    }).output();
    const found = await dbLogTrouble(since);
    assert(found.some((l) => l.includes('statement timeout')), `nothing found since ${since}`);
  },
});

Deno.test({
  name: 'lines from before the run are not reported',
  ignore: !up,
  async fn() {
    assertEquals(await dbLogTrouble(new Date(Date.now() + 60_000).toISOString()), []);
  },
});

Deno.test({
  name: 'a time that cannot be read is an error, not an empty answer',
  ignore: !up,
  async fn() {
    await assertRejects(() => dbLogTrouble('not-a-time'), Error, 'not a time');
  },
});

Deno.test('the lines that stop a run, taken from the log of 2026-11-06', () => {
  for (
    const line of [
      'ERROR:  canceling statement due to statement timeout',
      'ERROR:  deadlock detected',
      'LOG:  server process (PID 438341) was terminated by signal 15: Terminated',
      'LOG:  all server processes terminated; reinitializing',
      'LOG:  database system was not properly shut down; automatic recovery in progress',
      'PANIC:  could not write to file',
    ]
  ) assert(isLogTrouble(line), line);
  for (
    const line of [
      'ERROR:  supplied text: stale claim',
      'WARNING:  SET LOCAL can only be used in transaction blocks',
      'LOG:  checkpoint starting: time',
    ]
  ) assert(!isLogTrouble(line), line);
});
