import { allowedOrigins } from '../_shared/cors.ts';
import { serviceClient, userClient } from '../_shared/supabase.ts';
import { handleTranscription, type ModelCallRow } from './handler.ts';

if (import.meta.main) Deno.serve(req => handleTranscription(req, {
  apiKey: Deno.env.get('OPENROUTER_API_KEY') || '',
  origins: allowedOrigins(),
  fetch,
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
