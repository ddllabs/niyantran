import { identityRefusalMessage, verifiedLocalIdentity, localIdentityIsCurrent, reverifiedAccount, subscribeLocalIdentity } from './userStore.js';
import { functionsUrl, supabase } from './supabaseClient.js';

/**
 * POST one turn to the research-chat edge function and hand back the raw
 * response so the caller can read its SSE frames. The only AI send path since
 * the legacy /api/ai/chat route was retired (plan task D4).
 */
export async function sendResearchTurn({ body, signal, identity: expectedIdentity }) {
  const controller = new AbortController();
  let identity = null;
  let version = 0;
  const unsubscribe = subscribeLocalIdentity((id) => {
    // F43: the same account re-announced (a tab refocus, a token refresh) keeps
    // the request; the check after the fetch verifies that account again.
    if (identity && id === identity.id) return;
    version++;
    if (identity) controller.abort();
  });
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let response;
  try {
    identity = await verifiedLocalIdentity();
    const verifiedVersion = version;
    // The caller's identity may have been superseded by its own account's
    // refocus or token refresh (F43); only another account is refused.
    if (!identity || controller.signal.aborted || (expectedIdentity && identity.id !== expectedIdentity.id)
        || !await localIdentityIsCurrent(identity) || version !== verifiedVersion || controller.signal.aborted) {
      throw new Error(identityRefusalMessage('Sign in to use AI research.'));
    }
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${identity.token}`,
    };
    if (supabase?.supabaseKey) {
      headers.apikey = supabase.supabaseKey;
    }
    response = await fetch(functionsUrl('research-chat'), {
      method: 'POST', signal: controller.signal,
      headers,
      body: JSON.stringify(body),
    });
    if (!await reverifiedAccount(identity) || version !== verifiedVersion || controller.signal.aborted) {
      throw new Error('Your research session changed.');
    }
    return response;
  } catch (error) {
    if (response?.body) void response.body.cancel().catch(() => {});
    throw error;
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', abort);
  }
}
