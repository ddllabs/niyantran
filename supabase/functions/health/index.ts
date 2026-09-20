import { userClient } from '../_shared/supabase.ts';
import { handleHealth, type HealthRow } from './handler.ts';

async function probe(token: string): Promise<HealthRow> {
  const { data, error } = await userClient(token).rpc('ai_health');
  if (error) throw new Error(`ai_health: ${error.message}`);
  return data as HealthRow;
}

Deno.serve((req) => handleHealth(req, { probe, version: Deno.env.get('FUNCTION_VERSION') ?? 'dev' }));
