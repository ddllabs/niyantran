// The collection screens the screen command knows by name (docs/specs/2026-11-10-screening-stage.md). Each value builds
// one `Screen` (scripts/bulk-runner/screen_types.ts). Building a screen reads nothing and fetches nothing: the page
// check opens the network, the cache and the PDF reader only when it runs.
import type { Screen } from '../screen_types.ts';
import { makePageCheck } from '../page_check.ts';
import { makeBillsScreen } from './bills.ts';

export const SCREENS: Record<string, () => Promise<Screen>> = {
  'national-bills': () =>
    Promise.resolve(makeBillsScreen([
      makePageCheck({
        fetch: (input, init) => fetch(input, init),
        sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
        now: () => Date.now(),
      }),
    ])),
};
