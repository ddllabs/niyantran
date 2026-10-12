import { afterEach, expect, it, vi } from 'vitest';
import { createEarthMotion } from './earthMotion.js';
afterEach(() => vi.unstubAllGlobals());
it('stops frames on pause/dispose and resumes without a hidden-time rotation jump', () => {
  const frames = new Map(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', cb => { frames.set(++id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', n => frames.delete(n));
  const deltas = [], motion = createEarthMotion(dt => deltas.push(dt));
  const advance = time => { const [n, cb] = frames.entries().next().value; frames.delete(n); cb(time); };
  motion.setRunning(true); advance(100); advance(116);
  expect(deltas).toEqual([0, .016]);
  motion.setRunning(false); expect(frames.size).toBe(0);
  motion.setRunning(true); advance(90000); expect(deltas.at(-1)).toBe(0);
  motion.dispose(); expect(frames.size).toBe(0);
  motion.setRunning(true); expect(frames.size).toBe(0);
});
