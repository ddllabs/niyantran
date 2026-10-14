import { allowedOrigins } from '../_shared/cors.ts';
import { serviceClient, userClient } from '../_shared/supabase.ts';
import { handleTranscription, type ModelCallRow } from './handler.ts';

const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;

if (import.meta.main) Deno.serve(req => handleTranscription(req, {
  apiKey: Deno.env.get('OPENROUTER_API_KEY') || '',
  origins: allowedOrigins(),
  fetch,
  // The log insert runs after the response, kept alive by the runtime; where there is no
  // EdgeRuntime the handler awaits it, bounded, as before.
  waitUntil: edgeRuntime ? (work) => edgeRuntime.waitUntil(work) : undefined,
  // Dictation is free (owner decision 2026-10-14): this row records cost only.
  logModelCall: async (row: ModelCallRow) => {
    const { error } = await serviceClient().from('model_call_logs').insert(row);
    if (error) throw new Error(error.message);
  },
  active: async (token, userId) => {
    const { data, error } = await userClient(token).rpc('get_my_profile');
    if (error) throw new Error('Account verification unavailable');
    return data?.user_id === userId && data.status === 'active';
  },
}));
