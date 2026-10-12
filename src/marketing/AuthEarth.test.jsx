import { afterEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ states: [], cursor: 0 }));
vi.mock('react', async original => ({ ...(await original()), useState: initial => {
  const index = fake.cursor++;
  if (!(index in fake.states)) fake.states[index] = initial;
  return [fake.states[index], value => { fake.states[index] = typeof value === 'function' ? value(fake.states[index]) : value; }];
}, useRef: () => ({ current: null }), useEffect: () => {} }));
import AuthEarth from './AuthEarth.jsx';
import { PERSONAS } from '../lib/personas.js';

afterEach(() => { fake.states = []; });
function render(props = {}, state) {
  fake.cursor = 0; fake.states[1] = state ?? fake.states[1] ?? 'loading';
  return AuthEarth(props);
}
function all(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  for (const child of [node.props?.children].flat(Infinity)) all(child, predicate, found);
  return found;
}
const chips = tree => all(tree, n => n.props?.className?.includes?.('mkt-pchip'));
const poster = tree => all(tree, n => n.props?.className === 'auth-earth-poster');
const view = tree => all(tree, n => n.props?.onPointerDown)[0];

it('shows no stand-in photo while the globe loads, only if it cannot load', () => {
  expect(poster(render({}, 'loading'))).toHaveLength(0);
  expect(poster(render({}, 'ready'))).toHaveLength(0);
  expect(poster(render({}, 'fallback'))).toHaveLength(1);
});

it('places the six persona labels outside the drag area', () => {
  const tree = render({}, 'ready');
  expect(chips(tree).map(c => c.props.children.find?.(x => x?.props?.className === 'lab')?.props.children))
    .toEqual(PERSONAS.map(p => p.label));
  expect(chips(view(tree))).toHaveLength(0);
});

it('on sign-in a label reveals what the persona gets without selecting anything', () => {
  let tree = render({}, 'ready');
  const first = chips(tree)[0];
  expect(first.props['aria-pressed']).toBeUndefined();
  first.props.onClick();
  tree = render();
  expect(chips(tree)[0].props['aria-expanded']).toBe(true);
});

it('on signup a label selects that persona', () => {
  const onPersona = vi.fn();
  const tree = render({ persona: PERSONAS[2].id, onPersona }, 'ready');
  expect(chips(tree).map(c => c.props['aria-pressed'])).toEqual(PERSONAS.map((_, i) => i === 2));
  chips(tree)[4].props.onClick();
  expect(onPersona).toHaveBeenCalledWith(PERSONAS[4].id);
});

it('can leave persona labels to the page around it (homepage hero)', () => {
  const tree = render({ labels: false }, 'ready');
  expect(chips(tree)).toHaveLength(0);
  expect(tree.props.className).toBe('auth-earth');
  expect(render({}, 'ready').props.className).toBe('auth-earth labelled');
});
