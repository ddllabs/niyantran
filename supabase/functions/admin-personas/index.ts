import { serviceClient } from '../_shared/supabase.ts';
import { PERSONA_MAP } from '../_shared/personaMap.ts';
import { personaPrompt } from '../_shared/personas.ts';
import { HttpError } from '../_shared/http.ts';
import { handleAdminPersonas } from './handler.ts';

Deno.serve(req => handleAdminPersonas(req, {
  async access(actor) {
    const { data, error } = await serviceClient().rpc('persona_admin_access', { p_actor: actor }).abortSignal(AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]));
    if (error) throw new HttpError(503, 'Persona storage unavailable');
    return data === true;
  },
  async run(actor, input) {
    const { data, error } = await serviceClient().rpc('persona_admin', {
      p_actor: actor, p_action: input.action,
      p_persona: input.persona ?? null, p_text: input.action === 'save' ? input.text : null,
      p_expected: input.expected ?? null, p_revision: input.revision ?? null,
      p_baselines: input.action === 'initialize' ? Object.fromEntries(PERSONA_MAP.map(p => [p.db, personaPrompt(p.prompt)])) : null,
    }).abortSignal(AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]));
    if (error) throw new HttpError(error.code === '40001' ? 409 : error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 503,
      error.code === '40001' ? 'Version conflict. Reload the server version; your editor text has been retained.' : 'Persona operation unavailable');
    const settings = await serviceClient().from('persona_pilot_settings').select('enabled,global_enabled').eq('singleton', true).single()
      .abortSignal(AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]));
    if (settings.error) throw new HttpError(503, 'Persona audience unavailable');
    return { ...data, audience: !settings.data.enabled ? 'disabled' : settings.data.global_enabled ? 'all_users' : 'pilot' };
  },
}));
