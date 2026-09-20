import { serviceClient, userClient } from '../_shared/supabase.ts';
import { type AdminReadResult, handleAdminModels, type Kind, type WriteResult } from './handler.ts';

async function isAdmin(token: string): Promise<boolean> {
  const { data, error } = await userClient(token).rpc('is_platform_admin');
  if (error) throw new Error(`is_platform_admin: ${error.message}`);
  return data === true;
}

async function read(): Promise<AdminReadResult> {
  const svc = serviceClient();
  const [models, roles, catalogue] = await Promise.all([
    svc.from('ai_models').select('*').order('sort_order', { ascending: true }),
    svc.from('ai_roles').select('*').order('sort_order', { ascending: true }),
    svc
      .from('model_pricing')
      .select('model_id,context_length,max_completion_tokens,prompt_usd,completion_usd,supported_parameters')
      .eq('is_available', true)
      .contains('supported_parameters', ['tools'])
      .order('model_id', { ascending: true }),
  ]);
  for (const r of [models, roles, catalogue]) if (r.error) throw new Error(r.error.message);
  return { models: models.data ?? [], roles: roles.data ?? [], catalogue: catalogue.data ?? [] };
}

async function write(kind: Kind, row: Record<string, unknown>): Promise<WriteResult> {
  const { data, error } = await serviceClient().rpc('admin_models_upsert', { p_kind: kind, p_row: row });
  if (error) return { error: error.message };
  return { row: data as Record<string, unknown> };
}

Deno.serve((req) => handleAdminModels(req, { isAdmin, read, write }));
