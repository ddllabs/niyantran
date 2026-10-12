// A stopped globe owns no animation frame; resuming starts with zero elapsed time.
export function createEarthMotion(draw) {
  let frame = null, previous = null, running = false, disposed = false;
  function tick(time) {
    frame = null;
    if (!running || disposed) return;
    draw(previous === null ? 0 : Math.min((time - previous) / 1000, .1));
    previous = time;
    frame = requestAnimationFrame(tick);
  }
  function setRunning(value) {
    running = Boolean(value) && !disposed;
    if (!running) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previous = null;
    } else if (frame === null) frame = requestAnimationFrame(tick);
  }
  return { setRunning, dispose() { disposed = true; setRunning(false); } };
}
