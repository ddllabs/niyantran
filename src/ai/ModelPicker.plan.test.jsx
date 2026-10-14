import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ModelPicker, { ModelPlanNotice } from './ModelPicker.jsx';
import { OPEN_BILLING_EVENT } from './CreditBalance.jsx';

/**
 * F150 and F151 in the model picker: a model the plan does not allow is shown but cannot be chosen,
 * and each model says roughly what a typical answer costs, in credits.
 */
const model = (id, label, min_plan, extra = {}) => ({ model_id: id, label, vendor: id.split('/')[0], tier: 1, efforts: ['low', 'high'], min_plan, ...extra });
const MODELS = [
  model('google/gemini-3.5-flash-lite', 'Gemini Flash', 'free', { is_default: true }),
  model('anthropic/claude-haiku-5.5', 'Claude Haiku', 'free'),
  model('anthropic/claude-sonnet-5.5', 'Claude Sonnet', 'plus', { tier: 3 }),
  model('anthropic/claude-opus-5.5', 'Claude Opus', 'pro', { tier: 3 }),
  model('openai/astra', 'Astra', 'max', { tier: 3 }),
  // An older row, from before the column existed: for safety it needs a paid plan.
  model('mistral/legacy', 'Legacy Model', undefined),
];
const VALUE = { modelId: 'google/gemini-3.5-flash-lite', effort: 'low' };

function elements(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[].concat(node.props?.children || []).flat(Infinity).flatMap(elements)];
}
const row = (tree, label) => elements(tree).find((n) => String(n.props?.className || '').startsWith('ai-v2-model-opt')
  && elements(n).some((c) => c.type === 'em' && c.props.children === label));
const text = (node) => (node && typeof node === 'object' ? [].concat(node.props?.children || []).flat(Infinity).map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : '');
const open = (props) => ModelPicker({ models: MODELS, value: VALUE, open: true, ...props });
const html = (props) => renderToStaticMarkup(<ModelPicker models={MODELS} value={VALUE} open {...props} />);

describe('models a plan does not allow (F150)', () => {
  it('on Free: shows the paid models disabled with the plan that unlocks them, and the free ones enabled', () => {
    const tree = open({ plan: 'free' });
    for (const label of ['Gemini Flash', 'Claude Haiku']) expect(row(tree, label).props.disabled, label).toBeFalsy();
    for (const label of ['Claude Sonnet', 'Claude Opus', 'Astra', 'Legacy Model']) expect(row(tree, label).props.disabled, label).toBe(true);
    expect(text(row(tree, 'Claude Sonnet'))).toContain('Paid plans');
    expect(text(row(tree, 'Legacy Model'))).toContain('Paid plans');
    expect(text(row(tree, 'Claude Opus'))).toContain('Pro and Max');
    expect(text(row(tree, 'Astra'))).toContain('Max');
    expect(text(row(tree, 'Astra'))).not.toContain('Paid plans');
    expect(text(row(tree, 'Gemini Flash'))).not.toContain('plan');
  });

  it('gives a disabled row an accessible reason', () => {
    const tree = open({ plan: 'free' });
    expect(row(tree, 'Claude Sonnet').props['aria-label']).toBe('Claude Sonnet, available on paid plans');
    expect(row(tree, 'Claude Opus').props['aria-label']).toBe('Claude Opus, available on Pro and Max plans');
    expect(row(tree, 'Astra').props['aria-label']).toBe('Astra, available on the Max plan');
    expect(row(tree, 'Gemini Flash').props['aria-label']).toBeUndefined();
    expect(html({ plan: 'free' })).toMatch(/aria-label="Claude Sonnet, available on paid plans"[^>]*disabled=""|disabled=""[^>]*aria-label="Claude Sonnet, available on paid plans"/);
  });

  it('never chooses a model the plan does not allow, by the row, a role or a rung', () => {
    const changes = [];
    const roles = [{ role_id: 'DEEP', label: 'Deep', model_id: 'anthropic/claude-sonnet-5.5' }, { role_id: 'FAST', label: 'Fast', model_id: 'anthropic/claude-haiku-5.5' }];
    const tree = open({ plan: 'free', roles, effortsOpenFor: 'anthropic/claude-sonnet-5.5', onChange: (v) => changes.push(v) });
    row(tree, 'Claude Sonnet').props.onClick();
    const deep = elements(tree).find((n) => n.props?.className?.startsWith('ai-v2-role') && n.props.children === 'Deep');
    expect(deep.props.disabled).toBe(true);
    deep.props.onClick();
    expect(changes).toEqual([]);
    // No level control for a model that cannot be chosen, so its rungs cannot select it either.
    expect(elements(tree).some((n) => n.props?.className === 'ai-v2-model-disclose' && String(n.props['aria-label']).includes('Claude Sonnet'))).toBe(false);
    expect(elements(tree).some((n) => n.props?.className?.startsWith('ai-v2-effort'))).toBe(false);
    // The allowed ones still work.
    row(tree, 'Claude Haiku').props.onClick();
    expect(changes).toEqual([{ modelId: 'anthropic/claude-haiku-5.5', effort: 'low' }]);
    const fast = elements(tree).find((n) => n.props?.className?.startsWith('ai-v2-role') && n.props.children === 'Fast');
    expect(fast.props.disabled).toBeFalsy();
  });

  it('opens each model at its own minimum plan', () => {
    const at = (plan) => MODELS.filter((m) => !row(open({ plan }), m.label).props.disabled).map((m) => m.label);
    expect(at('free')).toEqual(['Gemini Flash', 'Claude Haiku']);
    expect(at('plus')).toEqual(['Gemini Flash', 'Claude Haiku', 'Claude Sonnet', 'Legacy Model']);
    expect(at('pro')).toEqual(['Gemini Flash', 'Claude Haiku', 'Claude Sonnet', 'Claude Opus', 'Legacy Model']);
    expect(at('max')).toEqual(MODELS.map((m) => m.label));
  });

  it('applies to any number of models, and never lists a disabled (turned off) model', () => {
    const many = Array.from({ length: 14 }, (_, i) => model(`v${i % 3}/m${i}`, `Model ${i}`, i % 2 ? 'free' : 'plus'));
    const out = renderToStaticMarkup(<ModelPicker models={[...many, model('x/off', 'Turned Off', 'free', { enabled: false })]} value={{ modelId: 'v0/m0' }} open plan="free" />);
    for (let i = 0; i < 14; i += 1) expect(out).toContain(`Model ${i}<`);
    expect(out).not.toContain('Turned Off');
    expect(out.match(/Paid plans/g)).toHaveLength(7);
    expect(out.match(/class="ai-v2-model-opt[^"]*"[^>]*disabled=""|disabled=""[^>]*class="ai-v2-model-opt/g)).toHaveLength(7);
  });

  it('puts no limit on any model when the caller gives no plan', () => {
    const tree = open({});
    for (const m of MODELS) expect(row(tree, m.label).props.disabled, m.label).toBeFalsy();
    expect(html({})).not.toContain('Paid plans');
  });
});

describe('credit estimates per model (F151)', () => {
  const estimates = { 'google/gemini-3.5-flash-lite': 4, 'anthropic/claude-sonnet-5.5': 170.4 };

  it('shows "≈ N credits" beside the cost diamonds, for the models that have an estimate', () => {
    const out = html({ plan: 'max', estimates });
    expect(out).toContain('≈ 4 credits');
    expect(out).toContain('≈ 170 credits');
    expect(out.match(/≈/g)).toHaveLength(2);
    expect(out).toContain('◆');
    const tree = open({ plan: 'max', estimates });
    expect(text(row(tree, 'Claude Opus'))).not.toContain('≈');
    expect(text(row(tree, 'Gemini Flash'))).toContain('≈ 4 credits');
  });

  it('shows nothing when there is none: no estimate, an empty set, or an unusable value', () => {
    expect(html({ plan: 'max' })).not.toContain('≈');
    expect(html({ plan: 'max', estimates: {} })).not.toContain('≈');
    expect(html({ plan: 'max', estimates: { 'google/gemini-3.5-flash-lite': null, 'anthropic/claude-haiku-5.5': 0, 'anthropic/claude-sonnet-5.5': NaN } })).not.toContain('≈');
  });

  it('works for any number of models, and still shows the estimate of a model the plan locks', () => {
    const many = Array.from({ length: 12 }, (_, i) => model(`v/m${i}`, `Model ${i}`, i < 6 ? 'free' : 'pro'));
    const all = Object.fromEntries(many.map((m, i) => [m.model_id, i + 1]));
    const out = renderToStaticMarkup(<ModelPicker models={many} value={{ modelId: 'v/m0' }} open plan="free" estimates={all} />);
    expect(out.match(/≈/g)).toHaveLength(12);
    expect(out).toContain('≈ 1 credit<');
    expect(out).toContain('≈ 12 credits');
  });

  it('shows credits only: no dollar, rupee or price text anywhere in the menu', () => {
    const out = html({ plan: 'free', estimates });
    expect(out).not.toMatch(/\$|USD|dollar|price|₹|rupee/i);
  });
});

describe('the refusal notice (F150)', () => {
  it('shows the server message as it was sent, with an Upgrade action that opens Plan & billing', () => {
    const upgrade = vi.fn();
    const tree = ModelPlanNotice({ message: 'This model is available on paid plans.', onUpgrade: upgrade });
    expect(tree.props.role).toBe('alert');
    expect(text(tree)).toContain('This model is available on paid plans.');
    const button = elements(tree).find((n) => n.type === 'button');
    expect(text(button)).toBe('Upgrade');
    button.props.onClick();
    expect(upgrade).toHaveBeenCalledOnce();
  });

  it('opens Plan & billing through the same event the credits notice uses', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    try {
      const seen = vi.fn();
      target.addEventListener(OPEN_BILLING_EVENT, seen);
      elements(ModelPlanNotice({ message: 'x' })).find((n) => n.type === 'button').props.onClick();
      expect(seen).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
