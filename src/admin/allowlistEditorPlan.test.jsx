// F155: the admin AI models page chooses which plans may use each model (ai_models.min_plan), shows
// the saved plan, and saves it through admin-models like every other field.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ capture: false, setters: [], presets: [] }));
vi.mock('react', async (original) => {
  const actual = await original();
  return {
    ...actual,
    useState: (value) => {
      if (!hooks.capture) return actual.useState(value);
      const setter = vi.fn();
      hooks.setters.push(setter);
      if (hooks.presets.length) return [hooks.presets.shift(), setter];
      return [typeof value === 'function' ? value() : value, setter];
    },
    // The editor is called as a plain function here, outside a render: a callback is itself and an effect never runs.
    useCallback: (fn, deps) => (hooks.capture ? fn : actual.useCallback(fn, deps)),
    useEffect: (...args) => (hooks.capture ? undefined : actual.useEffect(...args)),
  };
});
vi.mock('../lib/supabaseClient.js', () => ({
  accessToken: vi.fn(async () => 'token'),
  functionsUrl: vi.fn((name) => `https://functions.test/${name}`),
}));
vi.mock('../lib/aiRegistry.js', () => ({ notifyRegistryChanged: vi.fn() }));

import { AllowlistEditor } from './AllowlistEditor.jsx';

const MODELS = [
  { model_id: 'google/gemini-flash', label: 'Flash', vendor: 'google', tier: 1, efforts: ['low'], enabled: true, is_default: true, sort_order: 10, min_plan: 'free' },
  { model_id: 'anthropic/claude-opus', label: 'Opus', vendor: 'anthropic', tier: 3, efforts: ['high'], enabled: true, is_default: false, sort_order: 20, min_plan: 'pro' },
];
const DATA = { models: MODELS, roles: [], catalogue: [{ model_id: 'meta/new-model', prompt_usd: 1e-7, completion_usd: 4e-7 }] };

// useState order in AllowlistEditor: data, drafts, loading, readOnly, banner, errors, busy, addId, addPlan.
const STATE = { data: 0, drafts: 1, addId: 7, addPlan: 8 };
function state(over = {}) {
  const s = [DATA, {}, false, false, '', {}, '', '', 'plus'];
  for (const [k, v] of Object.entries(over)) s[STATE[k]] = v;
  return s;
}
function editor(over) {
  hooks.capture = true;
  hooks.setters = [];
  hooks.presets = state(over);
  return AllowlistEditor();
}

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = find(child, predicate); if (hit) return hit; }
    return null;
  }
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const byLabel = (tree, label) => find(tree, (n) => n.props?.['aria-label'] === label);
const rowOf = (tree, id) => find(tree, (n) => n.type === 'tr' && n.key === id);
const saveButton = (row) => find(row, (n) => n.type === 'button');
const addButton = (tree) => find(tree, (n) => n.type === 'button' && n.props.children === 'Add (disabled)');

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => DATA }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  hooks.capture = false;
  vi.unstubAllGlobals();
});

const putRows = () => fetchMock.mock.calls.filter(([, init]) => init.method === 'PUT').map(([, init]) => JSON.parse(init.body));

describe('AllowlistEditor: model plans', () => {
  it('shows a labelled plan selector for every model, set to its saved plan', () => {
    const markup = renderToStaticMarkup(editor());
    expect(markup).toContain('<th>Plans</th>');
    for (const m of MODELS) expect(markup).toContain(`aria-label="Plans that may use ${m.model_id}"`);
    const flash = markup.slice(markup.indexOf('aria-label="Plans that may use google/gemini-flash"'));
    expect(flash.slice(0, flash.indexOf('</select>'))).toMatch(/<option value="free" selected="">Free and paid plans<\/option>/);
    const opus = markup.slice(markup.indexOf('aria-label="Plans that may use anthropic/claude-opus"'));
    expect(opus.slice(0, opus.indexOf('</select>'))).toMatch(/<option value="pro" selected="">Pro and Max<\/option>/);
    for (const label of ['Free and paid plans', 'Paid plans', 'Pro and Max', 'Max only']) expect(flash).toContain(`>${label}</option>`);
  });

  it('reads a model without a stored plan as paid plans', () => {
    const markup = renderToStaticMarkup(editor({ data: { ...DATA, models: [{ ...MODELS[1], min_plan: undefined }] } }));
    const opus = markup.slice(markup.indexOf('aria-label="Plans that may use anthropic/claude-opus"'));
    expect(opus.slice(0, opus.indexOf('</select>'))).toMatch(/<option value="plus" selected="">Paid plans<\/option>/);
  });

  it('changing the selector edits the draft, and the saved plan stays visible until Save', () => {
    const t = editor();
    byLabel(t, 'Plans that may use google/gemini-flash').props.onChange({ target: { value: 'max' } });
    const update = hooks.setters[STATE.drafts].mock.calls.at(-1)[0];
    expect(update({})['google/gemini-flash']).toMatchObject({ model_id: 'google/gemini-flash', min_plan: 'max' });

    const drafts = { 'google/gemini-flash': { ...MODELS[0], efforts: 'low', min_plan: 'max' } };
    const markup = renderToStaticMarkup(editor({ drafts }));
    expect(markup).toContain('Not saved yet · currently Free and paid plans');
    expect(renderToStaticMarkup(editor())).not.toContain('Not saved yet');
  });

  it('Save sends the chosen plan with the row through admin-models', async () => {
    const drafts = { 'anthropic/claude-opus': { ...MODELS[1], efforts: 'high', min_plan: 'free' } };
    const t = editor({ drafts });
    await saveButton(rowOf(t, 'anthropic/claude-opus')).props.onClick();
    expect(fetchMock).toHaveBeenCalledWith('https://functions.test/admin-models', expect.objectContaining({ method: 'PUT' }));
    expect(putRows()).toEqual([{ kind: 'model', row: expect.objectContaining({ model_id: 'anthropic/claude-opus', min_plan: 'free', label: 'Opus' }) }]);
  });

  it('Save without a change sends the stored plan back unchanged', async () => {
    const t = editor();
    await saveButton(rowOf(t, 'google/gemini-flash')).props.onClick();
    expect(putRows()[0].row.min_plan).toBe('free');
  });

  it('adding a model sends Paid plans unless another plan is chosen', async () => {
    const t = editor({ addId: 'meta/new-model' });
    expect(byLabel(t, 'Plans that may use the new model').props.value).toBe('plus');
    addButton(t).props.onClick();
    await vi.waitFor(() => expect(putRows()).toHaveLength(1));
    expect(putRows()[0]).toEqual({ kind: 'model', row: { model_id: 'meta/new-model', label: 'new-model', enabled: false, min_plan: 'plus' } });

    const chosen = editor({ addId: 'meta/new-model', addPlan: 'free' });
    addButton(chosen).props.onClick();
    await vi.waitFor(() => expect(putRows()).toHaveLength(2));
    expect(putRows()[1].row.min_plan).toBe('free');
    // The selector goes back to Paid plans for the next model.
    expect(hooks.setters[STATE.addPlan].mock.calls.at(-1)).toEqual(['plus']);
  });

  it('a new model starts at Paid plans before anything is chosen', () => {
    hooks.capture = true;
    hooks.setters = [];
    hooks.presets = [];
    const markup = renderToStaticMarkup(AllowlistEditor());
    const add = markup.slice(markup.indexOf('aria-label="Plans that may use the new model"'));
    expect(add.slice(0, add.indexOf('</select>'))).toMatch(/<option value="plus" selected="">Paid plans<\/option>/);
  });

  it('the plan selectors are disabled when the page is read-only', () => {
    const t = editor();
    hooks.presets = state();
    hooks.presets[3] = true;
    const markup = renderToStaticMarkup(AllowlistEditor());
    expect(markup).toMatch(/<select aria-label="Plans that may use google\/gemini-flash" disabled=""/);
    expect(markup).toMatch(/<select aria-label="Plans that may use the new model" disabled=""/);
    expect(byLabel(t, 'Plans that may use google/gemini-flash').props.disabled).toBe(false);
  });
});
