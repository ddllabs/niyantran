// Files shipped in /public, resolved against the build's base so the app also runs from a
// sub-folder (the hosted preview) and not only from the site root.
const BASE = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '');
export const asset = (p) => (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? `${BASE}${p}` : p);
