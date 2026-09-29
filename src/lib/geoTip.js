// The map tooltip on GeoDotsMap (open-work F26). Point names and statuses come
// from desk feeds, so they are set as text and never parsed as HTML.
export function fillGeoTip(tip, d) {
  const doc = tip.ownerDocument;
  const name = doc.createElement('b');
  name.textContent = String(d.name ?? '');
  tip.replaceChildren(name, doc.createElement('br'), `${d.statusL || ''} · ${d.intensity ?? ''}`);
}
