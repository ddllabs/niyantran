// The stop rule of the F287 load (plan: "Stop rule: the run stops if the host falls below 6 GiB free", and
// "any failed job, statement timeout or deadlock"), as a pure function so it can be tested on its own.
// Each observation the load makes is passed in; the first condition that holds names the stop.

export const MIN_FREE_GIB = 6;

export interface Observation {
  /** Host free disk, GiB. */
  freeGiB?: number;
  /** The threshold; never below MIN_FREE_GIB. */
  minFreeGiB?: number;
  /** Jobs of this run in status failed, and the first one's code and message. */
  failedJobs?: number;
  failedWhy?: string;
  /** Database log lines that are statement timeouts or deadlocks. */
  trouble?: string[];
  /** Chunks of this run outside their expected partition. */
  wrongPartition?: number;
  partition?: string;
  /** The worker's own failure report (step_failed, advance_failed, unexpected). */
  workerFailure?: string;
}

export function stopFor(o: Observation): string | null {
  const min = Math.max(MIN_FREE_GIB, o.minFreeGiB ?? MIN_FREE_GIB);
  if (o.freeGiB !== undefined && o.freeGiB < min) {
    return `STOP: host free disk ${o.freeGiB.toFixed(1)} GiB is under ${min} GiB`;
  }
  if (o.failedJobs) return `STOP: ${o.failedJobs} job(s) failed (${o.failedWhy ?? 'no reason recorded'})`;
  if (o.trouble?.length) return `STOP: the database logged ${o.trouble[0].slice(0, 200)}`;
  if (o.wrongPartition) return `STOP: ${o.wrongPartition} chunks are outside ${o.partition ?? 'their partition'}`;
  if (o.workerFailure) return `STOP: the worker reported a failure: ${o.workerFailure.slice(0, 300)}`;
  return null;
}
