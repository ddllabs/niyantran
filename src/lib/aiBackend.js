/**
 * Which AI path the build uses (foundation spec §D).
 * 'supabase' only when VITE_AI_BACKEND is exactly that; anything else is the legacy path.
 * Read in three places only: the auth pages, the admin models page, and AiPanel's send path.
 */
export function aiBackend(env = import.meta.env) {
  return env && env.VITE_AI_BACKEND === 'supabase' ? 'supabase' : 'legacy';
}
