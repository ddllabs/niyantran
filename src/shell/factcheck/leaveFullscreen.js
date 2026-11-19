// F366: "See why" works on the panel, which sits outside the fullscreen video. So if the video is fullscreen,
// leave it first and act once it has finished; if leaving is refused or impossible, act anyway.
export function leaveFullscreenThen(doc, run) {
  if (doc?.fullscreenElement && typeof doc.exitFullscreen === 'function') {
    let result;
    try { result = doc.exitFullscreen(); } catch { result = null; }
    Promise.resolve(result).catch(() => {}).then(run);
    return;
  }
  run();
}
