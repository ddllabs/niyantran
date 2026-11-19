// F366: the fact-check panel is open by default. When nothing is going on and the video can be checked,
// the page opens the start screen itself, once for each thing played, so Cancel stays a real choice.
// The conditions are the ones the entry button waits for (FactCheckEntry), so nothing starts earlier.
export function shouldAutoChoose({ view, playable, key, done }) {
  if (!view?.flag?.available || !view.ready || !view.supported || !playable || !key) return false;
  if (view.session?.status !== 'idle') return false;
  return done !== key;
}
