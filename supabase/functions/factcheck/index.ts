import { allowedOrigins } from '../_shared/cors.ts';
import { serviceClient, userClient } from '../_shared/supabase.ts';
import { handleFactcheck } from './handler.ts';
import type { ModelCallRow } from './modelCall.ts';
import { postgrestStore } from './store.ts';

const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;

const handle = (req: Request) =>
  handleFactcheck(req, {
    apiKey: Deno.env.get('OPENROUTER_API_KEY') || '',
    origins: allowedOrigins(),
    fetch,
    // The log insert runs after the response, kept alive by the runtime; without EdgeRuntime the
    // handler awaits it, bounded.
    waitUntil: edgeRuntime ? (work) => edgeRuntime.waitUntil(work) : undefined,
    logModelCall: async (row: ModelCallRow) => {
      const { error } = await serviceClient().from('model_call_logs').insert(row);
      if (error) throw new Error(error.message);
    },
    active: async (token, userId) => {
      const { data, error } = await userClient(token).rpc('get_my_profile');
      if (error) throw new Error('Account verification unavailable');
      return data?.user_id === userId && data.status === 'active';
    },
    isAdmin: async (token) => {
      const { data, error } = await userClient(token).rpc('is_platform_admin');
      if (error) throw new Error('Account verification unavailable');
      return data === true;
    },
    rpc: async (name, args) => {
      const { data, error } = await serviceClient().rpc(name, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    store: postgrestStore(() => serviceClient()),
  });

if (import.meta.main) Deno.serve(handle);
