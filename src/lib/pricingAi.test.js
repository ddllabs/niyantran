// Owner decision 2026-09-29 (F2): no plan loses the AI research assistant, and
// the pricing page says so for every plan.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS } from './pricingStore.js';

const AI = 'AI research assistant';

describe('pricing lists the AI research assistant for every plan', () => {
  it('lists it on the free plan, which every other plan includes', () => {
    const explorer = DEFAULT_PLANS.find((p) => p.id === 'explorer');
    expect(explorer.items).toContain(AI);
  });

  it('gives every paid plan the whole chain back to Explorer', () => {
    const byId = Object.fromEntries(DEFAULT_PLANS.map((p) => [p.id, p]));
    expect(byId.pro.plus).toBe('Everything in Explorer, plus');
    expect(byId.enterprise.plus).toBe('Everything in Professional, plus');
    expect(byId.gov.plus).toBe('Everything in Enterprise, plus');
  });

  it('does not list it again as if it were a higher-tier feature', () => {
    for (const plan of DEFAULT_PLANS.filter((p) => p.id !== 'explorer')) {
      expect(plan.items).not.toContain(AI);
    }
  });
});
