import { verifiedLocalIdentity, localIdentityIsCurrent } from './userStore.js';
import { functionsUrl } from './supabaseClient.js';

/** Prompt bodies travel only to our authenticated persona endpoint, never to logs. */
export async function adminPersonas(input, { signal } = {}) {
  const identity = await verifiedLocalIdentity();
  if (!identity || !await localIdentityIsCurrent(identity)) throw new Error('Sign in with the pilot admin account.');
  let response;
  try {
    response = await fetch(functionsUrl('admin-personas'), {
      method: input ? 'POST' : 'GET', signal,
      headers: { authorization: `Bearer ${identity.token}`, 'content-type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Persona service could not be reached. Your editor text is retained; reload server versions before retrying.');
  }
  const data = await response.json().catch(() => ({}));
  if (!await localIdentityIsCurrent(identity)) throw new Error('Account changed. Reload the persona editor.');
  if (!response.ok) {
    const error = new Error(data.error || 'Persona service unavailable. Your editor text has been retained.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function personaEditorState(state, text) {
  if (!state) return 'Not initialized';
  if (text !== state.draft_text) return 'Unsaved changes';
  return state.draft_id === state.active_id ? 'Published version' : 'Saved draft · not published';
}
