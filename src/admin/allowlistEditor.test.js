import { describe, expect, it } from 'vitest';
import { catalogueChoices, formatEfforts, modelDraftToRow, parseEfforts, pricingLabel, rolesForDisplay } from './allowlistEditor.js';

describe('allowlist editor helpers', () => {
  it('offers only catalogue models that are not already listed, in id order', () => {
    const choices = catalogueChoices(
      [{ model_id: 'z/1' }, { model_id: 'a/1' }, { model_id: 'listed/1' }, { model_id: '' }],
      [{ model_id: 'listed/1', enabled: false }],
    );
    expect(choices.map((c) => c.model_id)).toEqual(['a/1', 'z/1']);
  });

  it('parses and formats efforts as a lower-cased, de-duplicated list', () => {
    expect(parseEfforts(' low, Medium ,high,low,,')).toEqual(['low', 'medium', 'high']);
    expect(parseEfforts('')).toEqual([]);
    expect(formatEfforts(['low', 'high'])).toBe('low, high');
  });

  it('renders per-million pricing and returns null when unknown', () => {
    expect(pricingLabel({ prompt_usd: 1e-7, completion_usd: 4e-7 })).toBe('$0.10 / $0.40 per M tokens');
    expect(pricingLabel({ prompt_usd: 1.5e-5, completion_usd: 7.5e-5 })).toBe('$15 / $75 per M tokens');
    expect(pricingLabel({ prompt_usd: null, completion_usd: 1 })).toBeNull();
    expect(pricingLabel(undefined)).toBeNull();
  });

  it('turns a draft into the row the function accepts, with safe defaults', () => {
    expect(modelDraftToRow({ model_id: ' v/a ', label: '', tier: '9', efforts: 'low', sort_order: 'x', enabled: 1, is_default: 0, updated_at: 'ignored' })).toEqual({
      model_id: 'v/a',
      label: 'v/a',
      tier: 2,
      efforts: ['low'],
      sort_order: 100,
      enabled: true,
      is_default: false,
    });
    expect(modelDraftToRow({ model_id: 'v/a', tier: 3, efforts: ['high'], sort_order: 5 }).tier).toBe(3);
  });

  it('shows all four roles even when the table is empty, merging saved rows over the seeds', () => {
    const empty = rolesForDisplay([]);
    expect(empty.map((r) => r.role_id)).toEqual(['DEFAULT_ANALYST', 'EXPERT_ESCALATION', 'PDF_PARSER', 'VISUAL_RESEARCH']);
    expect(empty[0].model_id).toBe('');
    const merged = rolesForDisplay([{ role_id: 'PDF_PARSER', label: 'Custom', hint: 'h', model_id: 'v/a', sort_order: 30 }, { role_id: 'EXTRA', label: 'X', hint: '', model_id: 'v/b', sort_order: 99 }]);
    expect(merged.find((r) => r.role_id === 'PDF_PARSER')).toMatchObject({ label: 'Custom', model_id: 'v/a' });
    expect(merged.map((r) => r.role_id)).toContain('EXTRA');
  });
});
