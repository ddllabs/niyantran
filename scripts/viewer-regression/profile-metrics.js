// Loopback harness instrumentation only. No page text, file paths or provider data in reports.
const round = value => Math.round(value * 100) / 100;
const quantile = (sorted, share) => sorted.length ? round(sorted[Math.ceil(sorted.length * share) - 1]) : null;

export function startProfile({ area, pageRows, metadata, scripted = false, startPage = 1, onDone }) {
  const duration = 12000;
  const width = area.querySelector('.pv-slot')?.offsetWidth;
  if (!width) throw new Error('Wait for the PDF page slots before profiling');
  const firstPage = Math.min(pageRows.length, Math.max(1, Math.trunc(Number.isFinite(startPage) ? startPage : 1)));
  const topFor = number => pageRows.slice(0, number - 1).reduce((top, row) => top + width * row.height_px / row.width_px + 12, 0);
  const startTop = topFor(firstPage);
  const targetPage = Math.min(firstPage + 14, pageRows.length);
  const target = Math.min(area.scrollHeight - area.clientHeight,
    topFor(targetPage));
  const gaps = [];
  const tasks = [];
  let observer;
  const longTaskSupported = globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask') ?? false;
  let started;
  let previous;
  let frame;
  let sampler;
  let finished = false;
  let maxCanvases = 0;
  let maxSpans = 0;
  let samplesWithLoading = 0;
  let visibleLoadingSamples = 0;
  let maxVisiblePages = 0;
  let samples = 0;
  const sample = () => {
    maxCanvases = Math.max(maxCanvases, area.querySelectorAll('.pv-canvas').length);
    maxSpans = Math.max(maxSpans, area.querySelectorAll('.textLayer span').length);
    samples++;
    if (area.querySelector('.pv-page-loading')) samplesWithLoading++;
    const visible = [...area.querySelectorAll('.pv-slot')].filter(slot => {
      const top = Number.parseFloat(slot.style.top);
      return top < area.scrollTop + area.clientHeight && top + Number.parseFloat(slot.style.height) > area.scrollTop;
    });
    maxVisiblePages = Math.max(maxVisiblePages, visible.length);
    if (visible.some(slot => slot.querySelector('.pv-page-loading'))) visibleLoadingSamples++;
  };
  const stop = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    clearInterval(sampler);
    if (observer) {
      tasks.push(...observer.takeRecords().filter(entry => entry.startTime >= started).map(entry => round(entry.duration)));
      observer.disconnect();
    }
    sample();
    const sorted = [...gaps].sort((a, b) => a - b);
    onDone({ ...metadata, mode: scripted ? 'scripted-15-pages' : 'manual', startPage: firstPage,
      elapsedMs: started === undefined ? 0 : round(performance.now() - started),
      frameCount: gaps.length, frameGapMs: { p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95),
        p99: quantile(sorted, 0.99), max: sorted.length ? round(sorted.at(-1)) : null },
      framesOver50Ms: gaps.filter(gap => gap > 50).length,
      longTaskSupported, longTaskCount: tasks.length, longTaskDurationsMs: tasks,
      maxLiveCanvases: maxCanvases, maxTextSpans: maxSpans,
      loadingSamplesIncludingOverscan: samplesWithLoading, visibleLoadingSamples, maxVisiblePages, samples,
      finalScrollTop: round(area.scrollTop), targetScrollTop: round(target), targetPage,
      finalPage: document.querySelector('.pv-page-field input')?.value ?? null,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      pane: { width: area.clientWidth, height: area.clientHeight },
      hidden: document.hidden });
  };
  // A separate settling interval permits the initial page reset/render; excluded from timing.
  if (scripted) area.scrollTop = startTop;
  const settleUntil = performance.now() + (scripted ? 1000 : 0);
  const tick = now => {
    if (now < settleUntil) { frame = requestAnimationFrame(tick); return; }
    if (started === undefined) {
      started = now;
      previous = now;
      if (longTaskSupported) {
        observer = new PerformanceObserver(list => tasks.push(...list.getEntries()
          .filter(entry => entry.startTime >= started).map(entry => round(entry.duration))));
        observer.observe({ type: 'longtask' });
      }
      sampler = setInterval(sample, 250);
      sample();
    } else gaps.push(now - previous);
    previous = now;
    if (scripted) area.scrollTop = startTop + (target - startTop) * Math.min(1, (now - started) / duration);
    if (scripted && now - started >= duration) { stop(); return; }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return stop;
}
