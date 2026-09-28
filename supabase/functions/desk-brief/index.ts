// Request-scoped wiring only. Importing this file reads no environment and
// starts no server; the handler owns validation, model choice and telemetry.
// OPENROUTER_API_KEY is read from Supabase secrets, never from the caller.
import { loadRegistry } from '../_shared/models.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { type DeskBriefDeps, handleDeskBrief, type ModelCallRow } from './handler.ts';

export function createDependencies(overrides: Partial<DeskBriefDeps> = {}): DeskBriefDeps {
  return {
    registry: () => loadRegistry(),
    deskModel: Deno.env.get('OPENROUTER_DESK_MODEL') ?? null,
    apiKey: Deno.env.get('OPENROUTER_API_KEY') ?? null,
    fetch: (...args) => fetch(...args),
    logModelCall: async (row: ModelCallRow) => {
      const { error } = await serviceClient().from('model_call_logs').insert(row);
      if (error) throw new Error(error.message);
    },
    ...overrides,
  };
}

if (import.meta.main) Deno.serve((req) => handleDeskBrief(req, createDependencies()));
