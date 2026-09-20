import { describe, expect, it } from 'vitest';
import { loadRegistry } from './aiRegistry.js';

/** A minimal fake of the PostgREST builder: every method chains, awaiting resolves the rows. */
function fakeClient(tables, seen = []) {
  return {
    from(name) {
      const result = { data: tables[name] ?? [], error: null };
      const builder = {
        select: () => builder,
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
