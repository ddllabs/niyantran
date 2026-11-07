// Prepared requests that never went through prepare: only the fields planning and running read.
import type { PlanLimits } from './plan.ts';
import type { PreparedRequest } from './prepare.ts';

export const hex = (n: number, salt = 'a') => (salt + n.toString(16)).padStart(64, '0').slice(-64);
export const BILLS = 'Bill Passage Probability Index';

export function fake(
  n: number,
  o: { chunks?: number; tokens?: number; feature?: string; text?: string; bytes?: number } = {},
): PreparedRequest {
  const source_key = `k${String(n).padStart(6, '0')}`;
  const payload = JSON.stringify({ source_key, pad: 'x'.repeat(o.bytes ?? 10) });
  return {
    source_key,
    request: { payload, payload_sha256: hex(n, 'b'), expected: [], pages: [], sections: [] },
    item: {
      source_key,
      payload_sha256: hex(n, 'b'),
      content_sha256: o.text ?? hex(n, 'c'),
      chunks: o.chunks ?? 1,
      est_tokens: o.tokens ?? 10,
    },
    desk: { tier: 'national', feature: o.feature ?? BILLS },
    controlCodesRemoved: 0,
  };
}
export const many = (count: number, o: Parameters<typeof fake>[1] = {}) =>
  Array.from({ length: count }, (_, i) => fake(i, o));

export const LIMITS: PlanLimits = {
  usdPerMTokens: 0.02,
  budgetUsd: 1000,
  chunkCeiling: 10_000_000,
  diskUsedBytes: 0,
  diskStopBytes: 10 ** 12,
  partitioned: [BILLS],
};
