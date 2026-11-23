// Map labels built from desk feed text (open-work F26). Feed values are set as
// text and never parsed as HTML. (F28's nuclear-site label helper left with
// NuclearSiteMap.jsx in F121; F122 removed it.)

// The tooltip on GeoDotsMap.
export function fillGeoTip(tip, d) {
  const doc = tip.ownerDocument;
  const name = doc.createElement('b');
  name.textContent = String(d.name ?? '');
  tip.replaceChildren(name, doc.createElement('br'), `${d.statusL || ''} · ${d.intensity ?? ''}`);
}
