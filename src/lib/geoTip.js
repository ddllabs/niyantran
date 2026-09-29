// Map labels built from desk feed text (open-work F26, F28). Feed values are
// set as text and never parsed as HTML.

// The tooltip on GeoDotsMap.
export function fillGeoTip(tip, d) {
  const doc = tip.ownerDocument;
  const name = doc.createElement('b');
  name.textContent = String(d.name ?? '');
  tip.replaceChildren(name, doc.createElement('br'), `${d.statusL || ''} · ${d.intensity ?? ''}`);
}

// The marker label on NuclearSiteMap (open-work F28), from facility feed rows.
export function fillSiteLabel(button, x) {
  const doc = button.ownerDocument;
  const span = doc.createElement('span');
  span.replaceChildren(String(x.name ?? ''), doc.createElement('br'), `${x.country} · ${x.facilityKind || x.kind}`);
  button.replaceChildren(span);
}
