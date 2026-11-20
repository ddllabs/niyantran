// From 1081px the video is sized from the height left for it (liveTv.css): the pinned zone's height, minus what sits
// under the video in the same column (the now-playing row: title, status, buttons), minus the gap. That row wraps
// with the window, so its height is measured, not assumed. The stylesheet keeps a fallback for the variable.
/** Whole pixels for a measured height, or null for a number that means nothing. */
export function nowPlayingPx(height) {
  return Number.isFinite(height) && height > 0 ? Math.round(height) : null;
}

/** Writes --ltv-np-h on `split` now and whenever `nowPlaying` changes size. Returns the cleanup. */
export function watchNowPlayingHeight(split, nowPlaying, ResizeObserverImpl = typeof ResizeObserver !== 'undefined' ? ResizeObserver : null) {
  if (!split || !nowPlaying || !split.style?.setProperty) return () => {};
  const apply = () => {
    const px = nowPlayingPx(nowPlaying.getBoundingClientRect().height);
    if (px !== null) split.style.setProperty('--ltv-np-h', `${px}px`);
  };
  apply();
  if (!ResizeObserverImpl) return () => {};
  const observer = new ResizeObserverImpl(apply);
  observer.observe(nowPlaying);
  return () => observer.disconnect();
}
