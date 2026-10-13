import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
const query = '(prefers-reduced-motion: reduce)';
const subscribe = callback => {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const snapshot = () => window.matchMedia(query).matches;
const coarseQuery = '(pointer: coarse)';
const subscribeCoarse = callback => {
  const media = window.matchMedia(coarseQuery);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const coarseSnapshot = () => window.matchMedia(coarseQuery).matches;
export const subscribeDeskVisibility = callback => {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
};
const hiddenSnapshot = () => document.hidden;
export const deskMotionPaused = (reduced, manualPause, hidden) => reduced || manualPause || hidden;

export function exploreDeskSectors(sectors, paused) {
  sectors?.scrollIntoView({ behavior: paused ? 'instant' : 'smooth', block: 'nearest' });
  sectors?.querySelector('.sector-card')?.focus({ preventScroll: true });
}

export function installHeroPan(root, paused, coarse) {
  const hero = root?.querySelector('.hero'), photo = root?.querySelector('.hero-photo');
  if (!hero || !photo) return undefined;
  const reset = () => photo.style.setProperty('--pan', '0px');
  reset();
  if (paused || coarse) return undefined;
  const pan = event => {
    if (event.pointerType !== 'mouse') return;
    const rect = hero.getBoundingClientRect();
    if (!rect.width) return;
    const amount = Math.max(-4, Math.min(4, ((event.clientX - rect.left) / rect.width - .5) * 8));
    photo.style.setProperty('--pan', `${amount}px`);
  };
  hero.addEventListener('pointermove', pan);
  hero.addEventListener('pointerleave', reset);
  return () => { hero.removeEventListener('pointermove', pan); hero.removeEventListener('pointerleave', reset); reset(); };
}

const shownText = value => value.toLocaleString('en-IN');
const target = node => (node.dataset.v6Count == null || node.dataset.v6Count === '' ? null : Number(node.dataset.v6Count));

/**
 * The desk landing's count-up (owner bug report, 2026-10-14: on load the counters ran from 0 two or
 * three times, or kept doing it). Summaries arrive one by one, and each arrival used to restart every
 * counter from 0. Now each number counts once: it starts from the value it shows (0 the first time)
 * and runs to its target; a number whose target did not change does not move, and a counter that lost
 * its value is left to React (no "NaN"). Paused, hidden or reduced motion shows the final values.
 */
export default function useDeskLandingMotion(countKey) {
  const ref = useRef(null);
  const shown = useRef(new WeakMap());
  const reduced = useSyncExternalStore(subscribe, snapshot, () => true);
  const coarse = useSyncExternalStore(subscribeCoarse, coarseSnapshot, () => true);
  const hidden = useSyncExternalStore(subscribeDeskVisibility, hiddenSnapshot, () => true);
  const [manualPause, setManualPause] = useState(false);
  const paused = deskMotionPaused(reduced, manualPause, hidden);
  useEffect(() => installHeroPan(ref.current, paused, coarse), [paused, coarse]);
  useEffect(() => {
    if (!ref.current) return undefined;
    const nodes = [...ref.current.querySelectorAll('[data-v6-count]')].filter(node => target(node) != null);
    if (paused) {
      nodes.forEach(node => { const to = target(node); node.textContent = shownText(to); shown.current.set(node, to); });
      return undefined;
    }
    const plan = nodes
      .map(node => ({ node, from: shown.current.has(node) ? shown.current.get(node) : 0, to: target(node) }))
      .filter(step => step.from !== step.to);
    if (!plan.length) return undefined;
    const start = performance.now();
    let frame;
    const tick = now => {
      const progress = Math.min(Math.max((now - start) / 1000, 0), 1);
      const eased = 1 - (1 - progress) ** 3;
      plan.forEach(({ node, from, to }) => {
        if (target(node) == null) return;
        const value = Math.round(from + (to - from) * eased);
        node.textContent = shownText(value);
        shown.current.set(node, value);
      });
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // A new target stops this run where it is; the next run continues from the shown values.
    return () => cancelAnimationFrame(frame);
  }, [paused, countKey]);
  return { ref, paused, reduced, toggle: () => setManualPause(value => !value) };
}
