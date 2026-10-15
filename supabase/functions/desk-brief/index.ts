// Request-scoped wiring only. Importing this file reads no environment and
// starts no server; the handler owns validation, model choice and telemetry.
// OPENROUTER_API_KEY is read from Supabase secrets, never from the caller.
// RECORD_BRIEF_MODEL (optional) picks the record-brief model (F123); unset, the
// handler's default is used. Either is used only when model_pricing lists it.
import { loadRegistry } from '../_shared/models.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { type DeskBriefDeps, handleDeskBrief, type ModelCallRow } from './handler.ts';
import type { ClaimResult, RecordBriefStore } from './record.ts';

const recordStore: RecordBriefStore = {
  storedRow: async (tier, feature, rowKey) => {
    const { data, error } = await serviceClient().from('desk_rows').select('row')
      .eq('tier', tier).eq('feature', feature).eq('row_key', rowKey).maybeSingle();
    if (error) throw new Error(error.message);
    const row = data?.row;
    return row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : null;
  },
  claim: async (a) => {
    const { data, error } = await serviceClient().rpc('record_brief_claim', {
      p_tier: a.tier,
      p_feature: a.feature,
      p_row_key: a.rowKey,
      p_hash: a.hash,
      p_source: a.source,
      p_user: a.userId,
      p_user_per_minute: a.limits.userPerMinute,
      p_user_per_day: a.limits.userPerDay,
      p_global_per_day: a.limits.globalPerDay,
      p_format: a.format,
    });
    if (error) throw new Error(error.message);
    return data as ClaimResult;
  },
  finish: async (a) => {
    const { data, error } = await serviceClient().rpc('record_brief_finish', {
      p_tier: a.tier,
      p_feature: a.feature,
      p_row_key: a.rowKey,
      p_token: a.token,
      p_brief: a.brief,
    });
    if (error) throw new Error(error.message);
    return data === true;
  },
  modelAvailable: async (model) => {
    const { data, error } = await serviceClient().from('model_pricing').select('model_id')
      .eq('model_id', model).eq('is_available', true).maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data);
  },
};

export function createDependencies(overrides: Partial<DeskBriefDeps> = {}): DeskBriefDeps {
  return {
    registry: () => loadRegistry(),
    deskModel: Deno.env.get('OPENROUTER_DESK_MODEL') ?? null,
    apiKey: Deno.env.get('OPENROUTER_API_KEY') ?? null,
    fetch: (...args) => fetch(...args),
    logModelCall: async (row: ModelCallRow) => {
      const { data, error } = await serviceClient().from('model_call_logs').insert(row).select('id').single();
      if (error) throw new Error(error.message);
      return typeof data?.id === 'string' ? data.id : null;
    },
    recordStore,
    recordModel: Deno.env.get('RECORD_BRIEF_MODEL') ?? null,
    ...overrides,
  };
}

if (import.meta.main) Deno.serve((req) => handleDeskBrief(req, createDependencies()));
