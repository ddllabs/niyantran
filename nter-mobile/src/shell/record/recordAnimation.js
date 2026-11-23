/**
 * The client's record animation (F211, owner 2026-10-16): the approved `nter-record-loader` web
 * component, copied unchanged into public/animation with its logo. It is loaded once, on the first
 * brief shown (F214: the animation plays for stored briefs too), so a visit that opens no record never
 * downloads it.
 */
export const RECORD_ANIMATION_SRC = `${import.meta.env.BASE_URL}animation/nter-record-loader.js`; // app: base-relative
export const RECORD_ANIMATION_LOGO = `${import.meta.env.BASE_URL}animation/logo.svg`; // app: base-relative
const TAG = 'nter-record-loader';

/** One load per element registry (the page has one; tests pass their own). */
const pending = new WeakMap();

/** Resolves true once the element is defined, false when it cannot be (no document, failed load). */
export function loadRecordAnimation(
  doc = typeof document === 'undefined' ? null : document,
  registry = typeof customElements === 'undefined' ? null : customElements,
) {
  if (!doc || !registry) return Promise.resolve(false);
  if (registry.get(TAG)) return Promise.resolve(true);
  if (pending.has(registry)) return pending.get(registry);
  const load = new Promise((resolve) => {
    const script = doc.createElement('script');
    script.src = RECORD_ANIMATION_SRC;
    script.async = true;
    // A failed load can be tried again on the next write.
    script.onerror = () => { pending.delete(registry); resolve(false); };
    registry.whenDefined(TAG).then(() => resolve(true));
    doc.head.appendChild(script);
  });
  pending.set(registry, load);
  return load;
}
