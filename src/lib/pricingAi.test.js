// Owner decision 2026-09-29 (F2): no plan loses the AI research assistant, and
// the pricing page says so for every plan.
import { describe, expect, it } from 'vitest';
import { PRICING_COMPARE, PUBLIC_PLANS } from './publicPlans.js';

describe('pricing lists the AI research assistant for every plan', () => {
  it('lists it on the free plan, which every other plan includes', () => {
    expect(PUBLIC_PLANS[0].items.some((item) => item.startsWith('AI research assistant'))).toBe(true);
    expect(PRICING_COMPARE.find((row) => row[0] === 'AI research assistant').slice(1)).toEqual([true, true, true, true]);
  });

  it('gives every paid plan the whole chain back to Free', () => {
    const byId = Object.fromEntries(PUBLIC_PLANS.map((p) => [p.id, p]));
    expect(byId.plus.plus).toBe('Everything in Free, plus');
    expect(byId.pro.plus).toBe('Everything in Plus, plus');
    expect(byId.max.plus).toBe('Everything in Pro, plus');
  });

  it('does not list it again as if it were a higher-tier feature', () => {
    for (const plan of PUBLIC_PLANS.slice(1)) {
      expect(plan.items.some((item) => item.startsWith('AI research assistant'))).toBe(false);
    }
  });
});
