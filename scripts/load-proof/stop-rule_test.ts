import { assert, assertEquals } from 'jsr:@std/assert@1';
import { MIN_FREE_GIB, stopFor } from './stop-rule.ts';

Deno.test('plenty of disk and nothing wrong does not stop', () => {
  assertEquals(stopFor({ freeGiB: 17.9, failedJobs: 0, trouble: [], wrongPartition: 0 }), null);
  assertEquals(stopFor({}), null);
});

Deno.test('under 6 GiB free stops, and 6 GiB exactly does not', () => {
  assert(stopFor({ freeGiB: 5.99 })?.startsWith('STOP: host free disk 6.0 GiB is under 6 GiB'));
  assertEquals(stopFor({ freeGiB: MIN_FREE_GIB }), null);
});

Deno.test('the threshold can be raised but never lowered', () => {
  assert(stopFor({ freeGiB: 10, minFreeGiB: 12 })?.includes('under 12 GiB'));
  assert(stopFor({ freeGiB: 5, minFreeGiB: 1 })?.includes('under 6 GiB'));
});

Deno.test('a failed job, a timeout, a deadlock, a misplaced chunk and a worker failure each stop', () => {
  assert(stopFor({ failedJobs: 1, failedWhy: 'embed_failed: 503' })?.includes('embed_failed'));
  assert(stopFor({ trouble: ['ERROR: canceling statement due to statement timeout'] })?.includes('statement timeout'));
  assert(stopFor({ trouble: ['ERROR: deadlock detected'] })?.includes('deadlock'));
  assert(
    stopFor({ wrongPartition: 3, partition: 'document_chunks_bills' })?.includes(
      '3 chunks are outside document_chunks_bills',
    ),
  );
  assert(stopFor({ workerFailure: '{"event":"worker.step_failed"}' })?.includes('worker'));
});
