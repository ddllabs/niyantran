// All default imports are blocked; the fixture must inject its own read-only client.
export const supabase = null;
export async function accessToken() { throw new Error('Live auth is unavailable in the local fixture.'); }
export function functionsUrl() { throw new Error('Live functions are unavailable in the local fixture.'); }
