import { afterEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ effects: [] }));
vi.mock('react', async (original) => ({ ...await original(), useRef: (current) => ({ current }), useEffect: (fn) => { hooks.effects.push(fn); }, useLayoutEffect: (fn) => { hooks.effects.push(fn); } }));
vi.mock('react-dom', () => ({ createPortal: (node) => node }));
import DeskSidebar from './DeskSidebar.jsx';
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
afterEach(() => { hooks.effects = []; vi.unstubAllGlobals(); });
it('focuses the drawer, traps Tab and escaped focus, dismisses Escape, then restores the opener and background', () => {
  const handlers = new Map(); const opener = { isConnected: true, focus: vi.fn() }, first = { focus: vi.fn() }, last = { focus: vi.fn() };
  const doc = { activeElement: opener, body: { style: { overflow: '' }, children: [] }, addEventListener: (type, fn) => handlers.set(type, fn), removeEventListener: (type) => handlers.delete(type) };
  vi.stubGlobal('document', doc); const close = vi.fn();
  const tree = DeskSidebar({ tab: 'home', lang: 'en', onDesk: vi.fn(), onClose: close, tabs: [] });
  const root = { contains: (node) => node === first || node === last }, background = { inert: false, contains: () => false };
  const dialog = { querySelectorAll: () => [first, last], contains: root.contains, focus: vi.fn() };
  for (const node of nodes(tree)) { if (node.props.className === 'desk-side-root' && node.props.ref) node.props.ref.current = root; if (node.props.role === 'dialog' && node.props.ref) node.props.ref.current = dialog; }
  doc.body.children = [background, root]; const cleanup = hooks.effects.map((fn) => fn());
  expect(first.focus).toHaveBeenCalled(); expect(background.inert).toBe(true);
  const preventDefault = vi.fn(); doc.activeElement = last; handlers.get('keydown')({ key: 'Tab', shiftKey: false, preventDefault, stopPropagation: () => {} }); expect(first.focus).toHaveBeenCalledTimes(2);
  doc.activeElement = first; handlers.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault, stopPropagation: () => {} }); expect(last.focus).toHaveBeenCalled();
  handlers.get('focusin')({ target: opener }); expect(first.focus).toHaveBeenCalledTimes(3);
  handlers.get('keydown')({ key: 'Escape', preventDefault, stopPropagation: () => {} }); expect(close).toHaveBeenCalledOnce();
  cleanup.forEach((fn) => fn?.()); expect(opener.focus).toHaveBeenCalled(); expect(background.inert).toBe(false); expect(doc.body.style.overflow).toBe('');
});
