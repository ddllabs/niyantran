/**
 * The composer's web-search globe (docs/specs/2026-10-13-web-search.md, section 6).
 *
 * It shows what the next turn will do and why. The state is the reader's override when there is one,
 * otherwise the panel's prediction from the scope (`webDefaultFor`); while a turn streams, the
 * server's own `web` decision for that turn wins, because the server is authoritative. A click sets
 * the override to the opposite of what is shown. A model that cannot search, and a turn in flight,
 * disable it.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { coverageCallerVersion, documentModules, observeCoverage, subscribeCoverage, webDefaultFor } from '../lib/corpusCoverage.js';

/** Models that never get the web tool: a `:free` model, or one the admin has switched off (spec section 1). */
export function isWebGated(model) {
  if (!model) return false;
  return String(model.model_id || '').toLowerCase().endsWith(':free') || model.params?.web_search === false;
}

const WORDS = {
  en: {
    web: 'Web',
    onAuto: 'Web search on (automatic)', offAuto: 'Web search off (automatic)',
    onYou: 'Web search on (you turned it on)', offYou: 'Web search off (you turned it off)',
    gated: "This model can't search the web",
    conversational: 'Web search off: this message needs no search',
    reasons: {
      'record-without-document': () => 'research can use this record and web sources',
      'module-without-documents': () => 'research can use web sources for this module',
      'documents-in-scope': (module) => (module ? 'research can use text from this module' : 'research can use text from this record'),
      'coverage-unknown': () => 'research will check available sources when you send',
      'no-record': () => 'no record is in scope',
      broad: () => 'broad questions can use sources across desks',
    },
  },
  hi: {
    web: 'वेब',
    onAuto: 'वेब खोज चालू (स्वचालित)', offAuto: 'वेब खोज बंद (स्वचालित)',
    onYou: 'वेब खोज चालू (आपने चालू की)', offYou: 'वेब खोज बंद (आपने बंद की)',
    gated: 'यह मॉडल वेब पर खोज नहीं कर सकता',
    conversational: 'वेब खोज बंद: इस संदेश को खोज की ज़रूरत नहीं',
    reasons: {
      'record-without-document': () => 'शोध इस रिकॉर्ड और वेब स्रोतों का उपयोग कर सकता है',
      'module-without-documents': () => 'शोध इस मॉड्यूल के लिए वेब स्रोतों का उपयोग कर सकता है',
      'documents-in-scope': (module) => (module ? 'शोध इस मॉड्यूल के पाठ का उपयोग कर सकता है' : 'शोध इस रिकॉर्ड के पाठ का उपयोग कर सकता है'),
      'coverage-unknown': () => 'भेजने पर शोध उपलब्ध स्रोतों की जाँच करेगा',
      'no-record': () => 'कोई रिकॉर्ड दायरे में नहीं है',
      broad: () => 'व्यापक प्रश्न अलग डेस्कों के स्रोतों का उपयोग कर सकते हैं',
    },
  },
};

/**
 * What the globe shows. Pure, so the wording is tested without a DOM.
 * @param {{ override?: boolean | null, predicted?: { on: boolean, reason: string | null } | null,
 *   server?: { offered: boolean, mode: string, reason: string } | null, gated?: boolean,
 *   streaming?: boolean, focus?: string, lang?: string }} input
 * @returns {{ on: boolean, disabled: boolean, label: string }}
 */
export function webToggleView({ override = null, predicted = null, server = null, gated = false, streaming = false, focus = 'attached', lang = 'en' } = {}) {
  const w = WORDS[lang === 'hi' ? 'hi' : 'en'];
  if (gated) return { on: false, disabled: true, label: w.gated };
  const disabled = Boolean(streaming);
  const decision = streaming && server && typeof server === 'object' && typeof server.offered === 'boolean' ? server : null;
  if (decision) {
    if (decision.reason === 'model-unsupported') return { on: false, disabled, label: w.gated };
    if (decision.reason === 'conversational') return { on: false, disabled, label: w.conversational };
    const on = decision.offered;
    if (decision.mode === 'on' || decision.mode === 'off') return { on, disabled, label: on ? w.onYou : w.offYou };
    const why = w.reasons[decision.reason]?.(focus === 'desk');
    return { on, disabled, label: `${on ? w.onAuto : w.offAuto}${why ? `: ${why}` : ''}` };
  }
  if (typeof override === 'boolean') return { on: override, disabled, label: override ? w.onYou : w.offYou };
  const on = Boolean(predicted?.on);
  const why = w.reasons[predicted?.reason]?.(focus === 'desk');
  return { on, disabled, label: `${on ? w.onAuto : w.offAuto}${why ? `: ${why}` : ''}` };
}

/**
 * The panel's prediction for the next turn. `attachments` are the chips on the chat and
 * `selectedRecord` is the selected row the next send will pin (null when it is already a chip or
 * nothing is selected); both are weighed under attached and selection focus. A keyed record whose
 * coverage has not answered yet makes the whole prediction unknown (off, no reason) rather than a
 * false "no indexed document": a lookup in flight is not evidence about the corpus.
 */
export function predictWeb({ focus, attachments = [], selectedRecord = null, indexedKeys = null, selectedIndexed = null, deskContext = null, modules = null }) {
  const records = focus === 'attached' || focus === 'selection'
    ? [...(attachments || []), ...(selectedRecord ? [selectedRecord] : [])] : (attachments || []);
  const merged = indexedKeys || selectedIndexed ? new Set([...(indexedKeys || []), ...(selectedIndexed || [])]) : null;
  return webDefaultFor({ focus, attachments: records, indexedKeys: merged, deskContext, modules });
}

/**
 * Gathers what the prediction needs that the panel does not already hold: the selected row's
 * coverage (the chips' own is the panel's `indexedKeys`) and, under desk focus, the document
 * modules, which `documentModules` fetches once and caches. Lookups wait while the panel is hidden.
 */
export function useWebPrediction({ focus, attachments, selectedRecord, indexedKeys, deskContext, open = true }) {
  const selectedKey = selectedRecord?.document_key || '';
  const [selectedAnswer, setSelectedAnswer] = useState({ key: '', set: null });
  const callerVersion = useSyncExternalStore(subscribeCoverage, coverageCallerVersion, coverageCallerVersion);
  const [moduleAnswer, setModules] = useState(null);
  useEffect(() => {
    if (!open || !selectedKey) return undefined;
    return observeCoverage([selectedKey], set => setSelectedAnswer({ key: selectedKey, set })) || undefined;
  }, [selectedKey, open]);
  useEffect(() => {
    if (!open || focus !== 'desk') return undefined;
    let alive = true;
    documentModules().then((rows) => { if (alive && rows) setModules({ rows, callerVersion }); }).catch(() => {});
    return () => { alive = false; };
  }, [focus, open, callerVersion]);
  const selectedIndexed = selectedAnswer.key === selectedKey ? selectedAnswer.set : null;
  const modules = moduleAnswer?.callerVersion === callerVersion ? moduleAnswer.rows : null;
  return useMemo(
    () => predictWeb({ focus, attachments, selectedRecord, indexedKeys, selectedIndexed, deskContext, modules }),
    [focus, attachments, selectedRecord, indexedKeys, selectedIndexed, deskContext, modules],
  );
}

function Globe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}

export default function WebSearchToggle({ override = null, predicted = null, server = null, gated = false, streaming = false, focus = 'attached', lang = 'en', onChange }) {
  const view = webToggleView({ override, predicted, server, gated, streaming, focus, lang });
  const w = WORDS[lang === 'hi' ? 'hi' : 'en'];
  return (
    <button
      type="button"
      className={`ai-v2-web${view.on ? ' on' : ''}`}
      aria-pressed={view.on}
      aria-label={view.label}
      title={view.label}
      disabled={view.disabled}
      onClick={() => { if (!view.disabled) onChange?.(!view.on); }}
    >
      <Globe />
      <span>{w.web}</span>
    </button>
  );
}
