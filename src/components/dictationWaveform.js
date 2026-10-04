/** Visualises the recorded stream locally; never connects microphone audio to speakers. */
export function observeRecording(stream, onFrame, {
  Context = globalThis.AudioContext || globalThis.webkitAudioContext,
  frame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
  now = () => performance.now(),
} = {}) {
  const start = now();
  let context, source, analyser, samples, tick, stopped = false;
  try {
    if (Context) {
      context = new Context();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser(); analyser.fftSize = 256;
      source.connect(analyser); samples = new Float32Array(analyser.fftSize);
      Promise.resolve(context.resume()).catch(() => {});
    }
  } catch {
    source?.disconnect(); context?.close()?.catch(() => {});
    context = source = analyser = undefined;
  }
  function draw() {
    if (stopped) return;
    let level = null;
    if (analyser) {
      analyser.getFloatTimeDomainData(samples);
      level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    }
    onFrame({ level, seconds: Math.floor((now() - start) / 1000) });
    tick = frame(draw);
  }
  tick = frame(draw);
  return () => {
    if (stopped) return;
    stopped = true; cancelFrame(tick);
    source?.disconnect(); analyser?.disconnect(); context?.close()?.catch(() => {});
  };
}

export function paintRecording(canvas, history, level, reduced = false) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getComputedStyle(canvas).color;
  if (reduced) {
    ctx.fillRect(0, height / 2 - 2, Math.max(2, Math.min(1, (level || 0) * 5) * width), 4);
    return;
  }
  history.push(level || 0); if (history.length > 32) history.shift();
  const step = width / 32;
  history.forEach((value, i) => {
    const size = Math.max(2, Math.min(1, value * 5) * (height - 4));
    ctx.fillRect(i * step, (height - size) / 2, Math.max(2, step - 2), size);
  });
}
