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

export default function useDeskLandingMotion(countKey) {
  const ref = useRef(null);
  const presentedKey = useRef(null);
  const reduced = useSyncExternalStore(subscribe, snapshot, () => true);
  const coarse = useSyncExternalStore(subscribeCoarse, coarseSnapshot, () => true);
  const hidden = useSyncExternalStore(subscribeDeskVisibility, hiddenSnapshot, () => true);
  const [manualPause, setManualPause] = useState(false);
  const paused = deskMotionPaused(reduced, manualPause, hidden);
  useEffect(() => installHeroPan(ref.current, paused, coarse), [paused, coarse]);
  useEffect(() => {
    if (paused || !ref.current || presentedKey.current === countKey) return;
    // Cleanup presents final values, so resuming unchanged data must not replay.
    presentedKey.current = countKey;
    const nodes = [...ref.current.querySelectorAll('[data-v6-count]')];
    const start = performance.now();
    let frame;
    const tick = now => {
      const progress = Math.min((now - start) / 1000, 1);
      nodes.forEach(node => {
        node.textContent = Math.round(Number(node.dataset.v6Count) * (1 - (1 - progress) ** 3)).toLocaleString('en-IN');
      });
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      nodes.forEach(node => { node.textContent = Number(node.dataset.v6Count).toLocaleString('en-IN'); });
    };
  }, [paused, countKey]);
  return { ref, paused, reduced, toggle: () => setManualPause(value => !value) };
}
