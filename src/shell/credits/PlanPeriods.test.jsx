import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const fake = vi.hoisted(() => ({ states: [], cursor: 0, effects: [], read: vi.fn(), open: vi.fn() }));
vi.mock('react', async original => ({ ...await original(),
  useEffect: effect => { fake.effects.push(effect); },
  useState: initial => { const i = fake.cursor++; if (!(i in fake.states)) fake.states[i] = initial;
    return [fake.states[i], value => { fake.states[i] = value; }]; },
}));
vi.mock('../../lib/billing.js', () => ({ fetchPlanPeriods: (...args) => fake.read(...args), openInvoice: (...args) => fake.open(...args) }));
import PlanPeriods from './PlanPeriods.jsx';
const period = { id: 'future', purchaseId: 'order-fixture', plan: 'plus', startsAt: '2026-11-20T12:00:00Z', endsAt: '2026-12-20T12:00:00Z', credits: 20000, status: 'scheduled', invoiceId: 'inv-future' };
function tree(revision = 0) { fake.cursor = 0; return PlanPeriods({ revision }); }
function nodes(n, test) { return !n || typeof n !== 'object' ? [] : [...(test(n) ? [n] : []), ...[n.props?.children].flat(Infinity).flatMap(x => nodes(x, test))]; }
beforeEach(() => { fake.states = []; fake.cursor = 0; fake.effects = []; fake.read.mockReset(); fake.open.mockReset(); });
it('shows loading and honest read errors instead of claiming no future purchase', async () => {
  expect(renderToStaticMarkup(tree())).toContain('Loading purchased plan periods');
  fake.read.mockRejectedValue(new Error('offline'));
  fake.effects[0](); await new Promise(resolve => setTimeout(resolve, 0));
  const html = renderToStaticMarkup(tree());
  expect(html).toContain('Purchased plan periods could not be loaded');
  expect(html).not.toContain('No upcoming paid periods');
});
it('shows confirmed future dates and allowance without claiming activation', () => {
  fake.states = [[period], ''];
  const t = tree(); const html = renderToStaticMarkup(t);
  expect(html).toContain('Plus'); expect(html).toContain('20 Nov 2026'); expect(html).toContain('20 Dec 2026');
  expect(html).toContain('20,000'); expect(html).toContain('Scheduled');
  expect(html).toContain('available when this period starts');
  nodes(t, n => n.type === 'button')[0].props.onClick();
  expect(fake.open).toHaveBeenCalledWith('inv-future');
});
it('distinguishes active purchased periods and the empty future schedule', () => {
  fake.states = [[{ ...period, status: 'active' }], ''];
  const html = renderToStaticMarkup(tree());
  expect(html).toContain('Active'); expect(html).not.toContain('available when this period starts');
  fake.states = [[], ''];
  expect(renderToStaticMarkup(tree())).toContain('No upcoming paid periods');
});
it('ignores a late response after unmount and re-reads on a purchase revision', async () => {
  let finish; fake.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  tree(); const cleanup = fake.effects[0](); cleanup(); finish([period]);
  await Promise.resolve(); expect(fake.states[0]).toBe(null);
  tree(1); fake.effects.at(-1)(); expect(fake.read).toHaveBeenCalledTimes(2);
});

it('does not insert a temporary compact period section that disappears after an empty read',async()=>{
 fake.read.mockResolvedValue([]);
 fake.cursor=0;
 expect(PlanPeriods({compact:true})).toBeNull();
 fake.effects[0](); await Promise.resolve(); fake.cursor=0;
 expect(PlanPeriods({compact:true})).toBeNull();
});
