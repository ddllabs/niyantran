/** Build navigation hashes without loading terminal schemas. */
export function deskHash(tab, feature) {
  if (!tab || tab === 'home') return '#/';
  const feat = String(feature || '').trim();
  if (!feat) return `#/${encodeURIComponent(tab)}`;
  return `#/${encodeURIComponent(tab)}/${encodeURIComponent(feat)}`;
}

