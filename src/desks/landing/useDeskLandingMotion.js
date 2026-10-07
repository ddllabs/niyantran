import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
const query = '(prefers-reduced-motion: reduce)';
const subscribe = callback => {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const snapshot = () => window.matchMedia(query).matches;

export default function useDeskLandingMotion(countKey) {
  const ref = useRef(null);
  const reduced = useSyncExternalStore(subscribe, snapshot, () => true);
  const [manualPause, setManualPause] = useState(false);
  const paused = reduced || manualPause;
  useEffect(() => {
    if (paused || !ref.current) return;
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
