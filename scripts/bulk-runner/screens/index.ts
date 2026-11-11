// The collection screens the screen command knows by name (docs/specs/2026-11-10-screening-stage.md). Each value builds
// one `Screen` (scripts/bulk-runner/screen_types.ts). Building a screen reads nothing and fetches nothing: the page
// check opens the network, the cache and the PDF reader only when it runs.
import type { Screen } from '../screen_types.ts';
import { makePageCheck } from '../page_check.ts';
import { makeBillsScreen } from './bills.ts';
import { makeSearchOnlyScreen, pdfUrlRule } from './search_only.ts';
import REGULATORY from './regulatory.json' with { type: 'json' };

const pageCheckDeps = {
  fetch: (input: URL | Request | string, init?: RequestInit) => fetch(input, init),
  sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  now: () => Date.now(),
};

export const SCREENS: Record<string, () => Promise<Screen>> = {
  'national-bills': () => Promise.resolve(makeBillsScreen([makePageCheck(pageCheckDeps)])),
  // Regulatory is the one search-only desk so far: its official PDFs (RBI's) are page-checked, the rest rest on the
  // density-only basis the configuration allows.
  'national-regulatory': () =>
    Promise.resolve(
      makeSearchOnlyScreen(REGULATORY, makePageCheck({ ...pageCheckDeps, urlRule: pdfUrlRule(REGULATORY) })),
    ),
};
