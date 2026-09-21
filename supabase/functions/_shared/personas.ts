// The persona prompts, bundled as a statically imported JSON module.
//
// They must be reachable through the import graph. `supabase functions deploy`
// uploads what that graph reaches; a runtime `Deno.readTextFile` with a
// computed path is invisible to it, so the markdown files were never shipped
// and every research turn failed in production with
// `path not found: .../_shared/personas/analyst.md` before any model was
// called. deskCatalog.json already ships this way.
//
// personas.json is generated from _shared/personas/*.md by
// `node scripts/build-personas.mjs`; personas_test.ts fails when it is stale.

import prompts from './personas.json' with { type: 'json' };

export const PERSONA_PROMPTS: Readonly<Record<string, string>> = prompts;

/** The prompt text for a persona file name, or null when it is not bundled. */
export function personaPrompt(file: string): string | null {
  return Object.hasOwn(PERSONA_PROMPTS, file) ? PERSONA_PROMPTS[file] : null;
}
