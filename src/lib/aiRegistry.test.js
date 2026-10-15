import { describe, expect, it } from 'vitest';
import { effectivePlan, loadRegistry, minPlanOf, modelAvailable, planNeededLabel, planNeededReason } from './aiRegistry.js';

/** A minimal fake of the PostgREST builder: every method chains, awaiting resolves the rows. */
function fakeClient(tables, seen = []) {
  return {
    from(name) {
      const result = { data: tables[name] ?? [], error: null };
      const builder = {
        select: (columns) => (seen.push(`${name}.select=${columns}`), builder),
        eq: (col, val) => (seen.push(`${name}.${col}=${val}`), builder),
        order: () => builder,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return builder;
    },
  };
}

describe('loadRegistry', () => {
  it('sorts models and roles by sort_order and indexes pricing by id', async () => {
    const seen = [];
    const client = fakeClient(
      {
        ai_models: [
          { model_id: 'v/b', label: 'B', sort_order: 20 },
          { model_id: 'v/a', label: 'A', sort_order: 10 },
        ],
        ai_roles: [{ role_id: 'R2', sort_order: 2 }, { role_id: 'R1', sort_order: 1 }],
        model_pricing: [{ model_id: 'v/a', prompt_usd: 1e-7 }],
      },
      seen,
    );
    const reg = await loadRegistry(client);
    expect(reg.models.map((m) => m.model_id)).toEqual(['v/a', 'v/b']);
    expect(reg.roles.map((r) => r.role_id)).toEqual(['R1', 'R2']);
    expect(reg.pricingById['v/a'].prompt_usd).toBe(1e-7);
    expect(seen).toContain('ai_models.enabled=true');
    expect(seen).toContain('model_pricing.is_available=true');
  });

  it('surfaces a database error instead of an empty registry', async () => {
    const client = {
      from: () => {
        const b = { select: () => b, eq: () => b, order: () => b, then: (res) => res({ data: null, error: { message: 'boom' } }) };
        return b;
      },
    };
    await expect(loadRegistry(client)).rejects.toThrow('boom');
  });

  it('refuses to run without a configured client', async () => {
    await expect(loadRegistry(null)).rejects.toThrow(/not configured/);
  });
});

describe('which models a plan may use (F150)', () => {
  it('reads each model\'s minimum plan with the allowlist', async () => {
    const seen = [];
    await loadRegistry(fakeClient({ ai_models: [{ model_id: 'v/a', label: 'A', min_plan: 'free' }] }, seen));
    expect(seen.find((s) => s.startsWith('ai_models.select='))).toMatch(/\bmin_plan\b/);
  });

  it('takes a missing or unknown minimum plan as plus, for safety', () => {
    expect(minPlanOf({ min_plan: 'free' })).toBe('free');
    expect(minPlanOf({ min_plan: 'pro' })).toBe('pro');
    expect(minPlanOf({ min_plan: 'max' })).toBe('max');
    for (const model of [{}, { min_plan: null }, { min_plan: 'gold' }, null, undefined]) expect(minPlanOf(model)).toBe('plus');
  });

  it('ranks the plans free < plus < pro < max', () => {
    const at = (plan) => ['free', 'plus', 'pro', 'max'].filter((min) => modelAvailable({ min_plan: min }, plan));
    expect(at('free')).toEqual(['free']);
    expect(at('plus')).toEqual(['free', 'plus']);
    expect(at('pro')).toEqual(['free', 'plus', 'pro']);
    expect(at('max')).toEqual(['free', 'plus', 'pro', 'max']);
    expect(modelAvailable({}, 'free')).toBe(false);
    expect(modelAvailable({}, 'plus')).toBe(true);
    expect(modelAvailable({ min_plan: 'max' }, 'nonsense')).toBe(false);
  });

  it('names the plans that unlock a model, in short and in a sentence', () => {
    expect(planNeededLabel({ min_plan: 'plus' })).toBe('Paid plans');
    expect(planNeededLabel({})).toBe('Paid plans');
    expect(planNeededLabel({ min_plan: 'pro' })).toBe('Pro and Max');
    expect(planNeededLabel({ min_plan: 'max' })).toBe('Max');
    expect(planNeededLabel({ min_plan: 'free' })).toBe('');
    expect(planNeededReason({ min_plan: 'plus' })).toBe('available on paid plans');
    expect(planNeededReason({ min_plan: 'pro' })).toBe('available on Pro and Max plans');
    expect(planNeededReason({ min_plan: 'max' })).toBe('available on the Max plan');
  });

  // Owner 2026-10-15: admins bypass the per-model plan lock (research-chat enforces it the same way).
  it('gives a platform admin every model in the picker, whatever the plan', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(effectivePlan({ plan: 'free', status: 'active' }, now, { admin: true })).toBe('max');
    expect(effectivePlan(null, now, { admin: true })).toBe('max');
    expect(effectivePlan({ plan: 'free', status: 'active' }, now, { admin: false })).toBe('free');
  });

  it('takes the effective plan from the server entitlement: lapsed, ended or unread is free', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    const active = { plan: 'pro', status: 'active', lapsed: false, periodEnd: '2026-11-01T00:00:00Z' };
    expect(effectivePlan(active, now)).toBe('pro');
    expect(effectivePlan({ ...active, plan: 'max', periodEnd: null }, now)).toBe('max');
    expect(effectivePlan({ ...active, plan: 'professional' }, now)).toBe('pro');
    expect(effectivePlan({ ...active, lapsed: true }, now)).toBe('free');
    expect(effectivePlan({ ...active, status: 'free' }, now)).toBe('free');
    expect(effectivePlan({ ...active, periodEnd: '2026-10-01T00:00:00Z' }, now)).toBe('free');
    expect(effectivePlan({ ...active, plan: 'free' }, now)).toBe('free');
    expect(effectivePlan(null, now)).toBe('free');
  });
});
