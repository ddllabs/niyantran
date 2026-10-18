import { expect, it } from 'vitest';
import { checkBundleBudget } from '../../scripts/bundle-budget.mjs';

it('rejects aggregate initial growth even when the entry alone is small', () => {
  expect(()=>checkBundleBudget({initialGzipBytes:183000,limit:182446,chunks:new Map([['entry.js','small']])})).toThrow('initial');
});
it('rejects large emitted chunks at the unchanged Vite500kB threshold', () => {
  expect(()=>checkBundleBudget({initialGzipBytes:100,limit:182446,chunks:new Map([['large.js','a'.repeat(500001)]])})).toThrow('large.js');
});
it('accepts split chunks only when their aggregate initial payload stays budgeted', () => {
  expect(()=>checkBundleBudget({initialGzipBytes:180722,limit:182446,chunks:new Map([['entry.js','small'],['vendor.js','small']])})).not.toThrow();
});
