import { allowedOrigins } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { handleTranscription } from './handler.ts';

if (import.meta.main) Deno.serve(req => handleTranscription(req, {
  apiKey: Deno.env.get('OPENAI_API_KEY') || '',
  origins: allowedOrigins(),
  fetch,
  active: async (token, userId) => {
    const { data, error } = await userClient(token).rpc('get_my_profile');
    if (error) throw new Error('Account verification unavailable');
    return data?.user_id === userId && data.status === 'active';
  },
}));
