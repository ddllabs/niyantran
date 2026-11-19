// The panel beside the video is held inside the window by CSS that needs to know how much sits above the split in
// the scrolling page body (padding, the channel bar, the gap). That depends on the bar, which has two rows and
// changes with the window, so it is measured, not assumed. The stylesheet keeps its old value as the fallback.
export const ABOVE_SPLIT_MARGIN = 16;

/** Pixels from the top of the scrolling body's content to the split, plus the margin kept below the window top. */
export function aboveSplitPx({ mainTop, mainScrollTop = 0, splitTop }) {
  const v = splitTop - mainTop + mainScrollTop + ABOVE_SPLIT_MARGIN;
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** Writes --ltv-above-split on `main` now and whenever `main` or `bar` changes size. Returns the cleanup. */
export function watchAboveSplit(main, split, bar, ResizeObserverImpl = typeof ResizeObserver !== 'undefined' ? ResizeObserver : null) {
  if (!main || !split || !main.style?.setProperty) return () => {};
  const apply = () => {
    const px = aboveSplitPx({ mainTop: main.getBoundingClientRect().top, mainScrollTop: main.scrollTop, splitTop: split.getBoundingClientRect().top });
    if (px !== null) main.style.setProperty('--ltv-above-split', `${px}px`);
  };
  apply();
  if (!ResizeObserverImpl) return () => {};
  const observer = new ResizeObserverImpl(apply);
  observer.observe(main);
  if (bar) observer.observe(bar);
  return () => observer.disconnect();
}
