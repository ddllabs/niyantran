import { useEffect, useRef } from 'react';

// Decorative DOM transforms stay out of React's data/render path.
export function useNationalMotion(paused) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0;
    const cards = [...root.querySelectorAll('.seg')];
    const layers = [...root.querySelectorAll('.backdrop .lyr:not(.clouds)')];
    const backdrop = root.querySelector('.backdrop .bg');
    const enabled = () => !paused && !reduced.matches && !document.hidden;
    const reset = () => {
      cards.forEach(card => { card.style.transform = ''; card.classList.remove('tilting'); });
      layers.forEach(layer => { layer.style.transform = ''; });
      if (backdrop) { backdrop.style.transform = ''; backdrop.style.opacity = ''; }
    };
    const sync = () => { root.dataset.motion = enabled() ? 'on' : 'off'; if (!enabled()) reset(); };
    const scroll = () => {
      if (!enabled() || !backdrop) return;
      const top = root.closest('main')?.scrollTop || window.scrollY;
      backdrop.style.transform = `translateY(${top * .28}px)`;
      backdrop.style.opacity = String(Math.max(0, 1 - top / 900));
    };
    const move = event => {
      if (!enabled() || !fine.matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = event.clientX / window.innerWidth - .5;
        const y = event.clientY / window.innerHeight - .5;
        layers.forEach(layer => { layer.style.transform = `translate(${x * 18 * Number(layer.dataset.d)}px,${y * 10 * Number(layer.dataset.d)}px)`; });
        const card = event.target.closest('.seg');
        cards.forEach(other => { if (other !== card) { other.style.transform = ''; other.classList.remove('tilting'); } });
        if (!card || !root.contains(card)) return;
        const r = card.getBoundingClientRect();
        const cx = (event.clientX - r.left) / r.width - .5;
        const cy = (event.clientY - r.top) / r.height - .5;
        card.classList.add('tilting');
        card.style.transform = `perspective(1200px) rotateX(${-cy * 4}deg) rotateY(${cx * 5}deg) translateY(-4px)`;
      });
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      entries.forEach(({ target, isIntersecting }) => {
        target.dataset.offscreen = isIntersecting ? 'false' : 'true';
        if (isIntersecting) target.classList.add('in');
      });
    }, { threshold: .05 });
    root.querySelectorAll('.seg,.backdrop,.card').forEach(node => { if (observer) observer.observe(node); else node.classList.add('in'); });
    sync(); scroll();
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', reset);
    window.addEventListener('scroll', scroll, true);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect(); reset();
      root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', reset);
      window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('visibilitychange', sync); reduced.removeEventListener('change', sync);
    };
  }, [paused]);
  return ref;
}
