import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const fake = vi.hoisted(() => ({ selected: null, effects: [], dialog: null }));
vi.mock('react', async original => ({ ...await original(),
  useState: () => [fake.selected, value => { fake.selected = value; }],
  useRef: () => ({ current: fake.dialog }), useId: () => 'plan-picker-test',
  useEffect: effect => { fake.effects.push(effect); },
}));
import PlanChangeDialog from './PlanChangeDialog.jsx';
const pro = { plan: 'pro', status: 'active', periodEnd: '2099-11-20T00:00:00Z' };
afterEach(() => { fake.selected = null; fake.effects = []; vi.unstubAllGlobals(); });
const children = tree => [tree.props.children].flat(Infinity);
const html = ent => renderToStaticMarkup(PlanChangeDialog({ ent, onClose: vi.fn(), onReview: vi.fn() }));

it('shows current access, included credits and requires selection before review', () => {
  const onReview = vi.fn();
  let tree = PlanChangeDialog({ ent: pro, onClose: vi.fn(), onReview });
  expect(children(tree).at(-1).props.disabled).toBe(true);
  children(tree).find(node => node?.props?.onSelect).props.onSelect('plus');
  expect(onReview).not.toHaveBeenCalled();
  tree = PlanChangeDialog({ ent: pro, onClose: vi.fn(), onReview });
  const out = renderToStaticMarkup(tree);
  expect(out).toContain('Current plan: <strong>PRO</strong>');
  expect(out).toContain('20,000 AI credits every month');
  expect(out).toContain('PLUS starts after that period ends');
  children(tree).at(-1).props.onClick();
  expect(onReview).toHaveBeenCalledExactlyOnceWith('plus');
});

it.each([['max', 'MAX starts now'], ['pro', 'Adds one month of PRO']])('explains %s timing before review', (plan, copy) => {
  fake.selected = plan;
  expect(html(pro)).toContain(copy);
});

it('treats lapsed Pro as Free rather than claiming active paid access', () => {
  expect(html({ ...pro, lapsed: true })).toContain('Current plan: <strong>FREE</strong>');
});

it('uses a native modal, closes on Escape and restores focus to the account trigger', () => {
  const focus = vi.fn(); const onClose = vi.fn(); const preventDefault = vi.fn();
  const trigger = { isConnected: true, focus };
  vi.stubGlobal('document', { querySelector: () => trigger });
  fake.dialog = { showModal: vi.fn(), close: vi.fn() };
  const tree = PlanChangeDialog({ ent: pro, onClose, onReview: vi.fn() });
  const cleanup = fake.effects.at(-1)();
  expect(fake.dialog.showModal).toHaveBeenCalledOnce();
  tree.props.onCancel({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
  cleanup();
  expect(fake.dialog.close).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce();
});
