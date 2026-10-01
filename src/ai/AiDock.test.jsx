import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('./AiPanel.jsx', () => ({ default: () => null }));
import AiDock, { dockNext } from './AiDock.jsx';

// panel-loading spec A: the dock mounts on its first open and stays mounted; closing hides it, so a
// reopen is instant and keeps the thread. D: every change is reported in the same step it is made.
it('A: nothing mounts before the first open; after it the dock stays mounted while closed', () => {
  expect(renderToStaticMarkup(<AiDock />)).toBe('');
  let s = { open: false, mounted: false };
  const seen = [];
  const report = (v) => seen.push(v);
  s = dockNext(s, true, report);
  expect(s).toEqual({ open: true, mounted: true });
  s = dockNext(s, false, report);
  expect(s).toEqual({ open: false, mounted: true });
  s = dockNext(s, false, report);
  s = dockNext(s, true, report);
  expect(s).toEqual({ open: true, mounted: true });
  // D: reported once per real change, synchronously, never for a no-op.
  expect(seen).toEqual([true, false, true]);
});
