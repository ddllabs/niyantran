import { useEffect, useState } from 'react';
import { deskForFeature, loadAnalysisMap, loadOntology } from '../../lib/impactRecord.js';

/**
 * Data a record adapter needs beyond its feed rows (F124). The bill-style National modules (bills,
 * questions, regulatory notices, the policy pipeline) read their analysis pack; bills and regulatory
 * notices also read the ontology (F204: the others no longer draw an impact graph). The panel host
 * loads them once and passes them to the adapter as ctx.packs, so adapters stay pure and synchronous.
 * Other modules need none (null).
 */

/** The desks whose adapters read the ontology: bills (the PDF link) and regulatory notices (classes). */
const ONTOLOGY_DESKS = new Set(['bill', 'regulatory']);

/** The bill-style desk configuration for a feature, or null. */
export const packDeskFor = (feature) => deskForFeature(feature);

/** { desk, analysis, ontology, ready: true } for a bill-style module, else null. Never throws. */
export async function loadRecordPacks(feature) {
  const desk = packDeskFor(feature);
  if (!desk) return null;
  const [analysis, ontology] = await Promise.all([
    loadAnalysisMap(desk.analysis).catch(() => ({})),
    ONTOLOGY_DESKS.has(desk.key) ? loadOntology().catch(() => null) : null,
  ]);
  return { desk, analysis: analysis || {}, ontology: ontology || null, ready: true };
}

/** The packs for a feature: not ready (empty) until they load, then the loaded packs. */
export function useRecordPacks(feature) {
  const desk = packDeskFor(feature);
  const key = desk?.key || '';
  const [state, setState] = useState({ key: '', packs: null });
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    loadRecordPacks(feature).then((packs) => { if (alive) setState({ key, packs }); });
    return () => { alive = false; };
    // The desk key identifies the packs; a renamed feature for the same desk needs no reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!desk) return null;
  return state.key === key ? state.packs : { desk, analysis: null, ontology: null, ready: false };
}
