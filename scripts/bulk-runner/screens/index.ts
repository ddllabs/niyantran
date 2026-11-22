// The collection screens the screen command knows by name (docs/specs/2026-11-10-screening-stage.md). Each value builds
// one `Screen` (scripts/bulk-runner/screen_types.ts). Building a screen reads nothing and fetches nothing: the page
// check opens the network, the cache and the PDF reader only when it runs.
import type { Screen } from '../screen_types.ts';
import { makePageCheck } from '../page_check.ts';
import { makeBillsScreen } from './bills.ts';
import { makeBillCorrigendaScreen } from './bill_corrigenda.ts';
import { makeSearchOnlyScreen, pdfUrlRule } from './search_only.ts';
import REGULATORY from './regulatory.json' with { type: 'json' };
import BUDGET from './budget.json' with { type: 'json' };
import CABINET from './cabinet.json' with { type: 'json' };
import TRANSFERS from './transfers.json' with { type: 'json' };
import INDUSTRY from './industry.json' with { type: 'json' };
import MP_PROFILES from './mp_profiles.json' with { type: 'json' };

const pageCheckDeps = {
  fetch: (input: URL | Request | string, init?: RequestInit) => fetch(input, init),
  sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  now: () => Date.now(),
};

/**
 * A search-only desk of the National packs (docs/specs/2026-11-19-five-desk-search-only-route.md): the configuration
 * file is hashed with the rules in its own name, and the page check is built with the configuration's PDF rule.
 */
const deskScreen = (config: unknown, file: string) => (): Promise<Screen> =>
  Promise.resolve(
    makeSearchOnlyScreen(config, makePageCheck({ ...pageCheckDeps, urlRule: pdfUrlRule(config) }), {
      configFile: `scripts/bulk-runner/screens/${file}`,
    }),
  );

export const SCREENS: Record<string, () => Promise<Screen>> = {
  'national-bills': () => Promise.resolve(makeBillsScreen([makePageCheck(pageCheckDeps)])),
  // F372: the pack's Bill corrigenda (no file link, so no page check); their bill is read from their own links.
  'national-bill-corrigenda': () => Promise.resolve(makeBillCorrigendaScreen()),
  // Regulatory: its official PDFs (RBI's) are page-checked, the rest rest on the density-only basis the configuration
  // allows.
  'national-regulatory': () =>
    Promise.resolve(
      makeSearchOnlyScreen(REGULATORY, makePageCheck({ ...pageCheckDeps, urlRule: pdfUrlRule(REGULATORY) })),
    ),
  // The five desks of F374. Each configuration says which of its files are page-checked and which rest on density.
  'national-budget': deskScreen(BUDGET, 'budget.json'),
  'national-cabinet': deskScreen(CABINET, 'cabinet.json'),
  'national-transfers': deskScreen(TRANSFERS, 'transfers.json'),
  'national-industry': deskScreen(INDUSTRY, 'industry.json'),
  'national-mp-profiles': deskScreen(MP_PROFILES, 'mp_profiles.json'),
};

/** Whether the screen for a collection reads the collection file's prepare block (`Screen.usesPrepare`). */
export async function screenUsesPrepare(collection: string): Promise<boolean> {
  for (const make of Object.values(SCREENS)) {
    const screen = await make();
    if (screen.collection === collection) return screen.usesPrepare === true;
  }
  return false;
}
