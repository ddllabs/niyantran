// Optional private lifecycle bridge: the refresh gate pauses a caller's active
// request clock while queued. Symbol metadata is stripped before native fetch.
export const SOURCE_ATTEMPT = Symbol('source-attempt');

/** One JSON request, including body download, bounded by active source time. */
export async function sourceJsonAttempt(url, timeoutMs, headers) {
  const controller = new AbortController();
  let timer, activeAt, workerSignal, rejectStopped;
  let activeMs = 0;
  let stoppedCode = '';
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const stopClock = () => {
    clearTimeout(timer);
    if (activeAt != null) activeMs += Math.max(0, performance.now() - activeAt);
    activeAt = null;
  };
  const cancel = code => {
    if (stoppedCode) return;
    stoppedCode = code;
    stopClock();
    controller.abort();
    rejectStopped(new Error('source attempt stopped'));
  };
  const workerCancelled = () => cancel('cancelled');
  const lifecycle = {
    queued(signal) {
      stopClock();
      workerSignal = signal;
      if (signal.aborted) workerCancelled();
      else signal.addEventListener('abort', workerCancelled, { once: true });
    },
    active() {
      stopClock();
      activeAt = performance.now();
      timer = setTimeout(() => cancel('timeout'), Math.max(0, timeoutMs - activeMs));
    },
    finished: stopClock,
  };
  lifecycle.active(); // Native fetch outside a refresh has no host queue.
  try {
    const payload = await Promise.race([
      (async () => {
        const response = await fetch(url, { signal: controller.signal, headers, [SOURCE_ATTEMPT]: lifecycle });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw Object.assign(new Error('source HTTP failure'), { code: 'http', httpStatus: response.status });
        }
        try { return await response.json(); }
        catch (error) {
          throw Object.assign(new Error('source body failure'), { code: error?.name === 'SyntaxError' ? 'invalid' : 'transport' });
        }
      })(),
      stopped,
    ]);
    stopClock();
    return { payload, activeMs };
  } catch (error) {
    stopClock();
    const code = stoppedCode || (['http', 'invalid'].includes(error?.code) ? error.code : 'transport');
    throw Object.assign(new Error(`source attempt ${code}`), { code, activeMs,
      ...(code === 'http' ? { httpStatus: error.httpStatus } : {}) });
  } finally {
    stopClock();
    workerSignal?.removeEventListener('abort', workerCancelled);
  }
}
