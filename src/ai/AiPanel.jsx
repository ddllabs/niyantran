import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { setChatAttachments } from '../lib/aiThreads.js';
import { filesFromDrop, isModuleAttachment, materializeAiDrop, readAiDrag } from '../lib/aiDrop.js';
import { rowPinKey } from '../lib/sourceUrls.js';
import { billDocumentKey, deskRowKey } from '../lib/deskRows.js';
import { COVERAGE_TTL_MS, coverageOf, recheckCoverage, refreshCoverage } from '../lib/corpusCoverage.js';
import useResearchThread from './useResearchThread.js';
import './research.css';
import AiMarkdown from './AiMarkdown.jsx';
import ActivityTicker from './ActivityTicker.jsx';
import ModelPicker from './ModelPicker.jsx';
import MessageRow from './MessageRow.jsx';
import SuggestionPills from './SuggestionPills.jsx';
import WorkSurface from './WorkSurface.jsx';
import CitationOverlay from './CitationOverlay.jsx';
import { isReadableCitation } from './CitationBubble.jsx';
import { createStickToBottom } from './stickToBottom.js';

export const FOCUS_OPTS = [
  { id: 'attached', en: 'Attached only', hi: 'केवल संलग्न', hint: 'Pins and files in this chat' },
  { id: 'selection', en: 'Selection + pins', hi: 'चयन + पिन', hint: 'Selected desk row plus attachments' },
  // retrieval-scope decision 3: desk focus filters document searches to the
  // open module when it has documents, so it is no longer only a row sample.
  { id: 'desk', en: 'Desk', hi: 'डेस्क', hint: 'Rows from the open module plus pins; document searches are limited to this module' },
  { id: 'broad', en: 'Broad context', hi: 'विस्तृत संदर्भ', hint: 'Pins, selection, and desk sample' },
];

const DOCS_EN = [
  'Answers are grounded in the retrieval scope you set — not the whole internet.',
  'If a fact is missing from that scope, the assistant should say “Not in record.”',
  'Attach desk rows or files for evidence. Evidence is listed before interpretation.',
  'No buy / sell / hold language. No invented citations or fake typing.',
];

const DOCS_HI = [
  'उत्तर आपके चुने हुए पुनर्प्राप्ति दायरे में आधारित हैं — पूरे इंटरनेट पर नहीं।',
  'यदि तथ्य दायरे में नहीं है, सहायक को “Not in record” कहना चाहिए।',
  'साक्ष्य के लिए पंक्तियाँ या फ़ाइलें जोड़ें। व्याख्या से पहले साक्ष्य।',
  'खरीद/बेच/होल्ड भाषा नहीं। बनावटी उद्धरण या नकली टाइपिंग नहीं।',
];

// The last line differs by path: work mode used to change the prompt, and now
// opens the evidence instead — answers are evidence-first either way.
const DOCS_WORK_EN = 'Work mode opens the evidence behind an answer: the passage, or the record.';
const DOCS_WORK_HI = 'Work mode उत्तर के पीछे का साक्ष्य खोलता है: अंश, या रिकॉर्ड।';

function contextLabel({ attachments, selected, featureName }) {
  const attached = (attachments || []).map((a) => a.title || a.feature).filter(Boolean);
  const picked =
    selected?.conflict_name ||
    selected?.bill_name ||
    selected?.subject ||
    selected?.title ||
    selected?.name;
  return String(attached[0] || picked || featureName || 'this material').trim();
}

function contextualPrompts({ attachments, selected, featureName }) {
  const topic = contextLabel({ attachments, selected, featureName });
  const hay = `${featureName || ''} ${topic}`.toLowerCase();

  if (/conflict|front|war|security|defen[cs]e/.test(hay)) {
    return [
      `Build a dated timeline of the recorded changes in ${topic}.`,
      `Separate verified facts, actor claims and unresolved points for ${topic}.`,
      `Which actors, regions and institutions are most relevant to this dossier?`,
    ];
  }
  if (/bill|legislat|parliament|policy|cabinet/.test(hay)) {
    return [
      `Explain the current recorded stage of ${topic} and what changed most recently.`,
      `Which institutions, sectors and provisions does ${topic} touch?`,
      `Compare the attached record with related measures in this packet.`,
    ];
  }
  if (/court|judg|case|law|verdict/.test(hay)) {
    return [
      `State the issue, holding and reasoning documented for ${topic}.`,
      `Identify the provisions and precedents cited in the attached material.`,
      `What is explicit in the record, and what would require further legal research?`,
    ];
  }
  if (/econom|market|budget|trade|carbon|commodit/.test(hay)) {
    return [
      `Summarise the latest recorded change in ${topic} and its measurement basis.`,
      `Which series or entities provide the most useful comparison for ${topic}?`,
      `Flag gaps, revisions or incompatible units in the attached data.`,
    ];
  }
  if (/transit|ship|air|flight|vessel/.test(hay)) {
    return [
      `Explain what this position record confirms about ${topic}.`,
      `Separate live fields from inferred or unavailable route details.`,
      `What should I compare across the attached transit records?`,
    ];
  }
  return [
    `What does the attached material document about ${topic}?`,
    `Organise the evidence into a short chronology and key entities.`,
    `Where is the record specific, and where is more evidence needed?`,
  ];
}

function rowTitle(row) {
  return row.bill_name || row.title || row.name || row.subject || row.conflict_name || row.commodity || 'Selected record';
}

/**
 * Whether `pins` already holds a chip for this desk row. Two bill rows are the
 * same bill when their document keys are: `rowPinKey` reads `bill_number`
 * first, and Bill No. 70 of 2007 and Bill No. 70 of 2010 share one.
 */
export function rowIsPinned(pins, row) {
  if (!row) return false;
  const doc = billDocumentKey(row);
  const key = rowPinKey(row);
  const title = row.bill_name || row.title || row.name;
  return (pins || []).some((a) => {
    if (a?.kind !== 'row') return false;
    if (doc && a.document_key) return a.document_key === doc;
    return Boolean((key && rowPinKey(a.preview || {}) === key) || (title && a.title === title));
  });
}

// Match research-chat/validate.ts limits without inventing or truncating keys.
// A changed fallback hash cannot identify the selected authoritative desk row.
export function researchSelection(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const bounded = {};
  let count = 0;
  for (const key in row) {
    if (!Object.hasOwn(row, key) || key.length > 200) continue;
    const value = row[key];
    if (value == null || value === '' || typeof value === 'object') continue;
    bounded[key] = String(value).slice(0, 500);
    if (++count >= 64) break;
  }
  if (!Object.keys(bounded).length) return null;
  if (deskRowKey(bounded) !== deskRowKey(row)) {
    throw new Error('This selection cannot be matched within the research limits. Clear the selected row to ask without selection, or use desk search.');
  }
  return bounded;
}

/**
 * The chips as research-chat attachments. A `document` chip is a pointer to a
 * corpus document, never its text (retrieval-scope spec): it travels as
 * `{kind, title, document_id}` and the server scopes searches to that id.
 */
export function requestAttachments(pins) {
  return (pins || [])
    .map((a) => a.kind === 'document' ? {
      kind: 'document',
      title: String(a.title || 'Document'),
      document_id: String(a.document_id || ''),
    } : ({
      kind: a.kind === 'row' || a.kind === 'record' ? a.kind : 'file',
      title: String(a.title || a.feature || 'Attachment'),
      text: String(a.text || a.preview?.record_text || ''),
      ...(a.feature ? { feature: a.feature } : {}),
      ...(a.preview ? { row_key: deskRowKey(a.preview) } : {}),
      ...(a.document_key ? { document_key: a.document_key } : {}),
    }))
    .filter((a) => (a.kind === 'document' ? a.document_id : a.text));
}

/** The chip "Ask about this document" attaches for a text citation, or null. */
export function documentChip(citation) {
  const id = typeof citation?.document_id === 'string' ? citation.document_id.trim() : '';
  const title = typeof citation?.title === 'string' ? citation.title.trim() : '';
  if (!id || !title) return null;
  return { kind: 'document', title, document_id: id, ...(typeof citation.desk_feature === 'string' && citation.desk_feature ? { feature: citation.desk_feature } : {}) };
}

/**
 * retrieval-scope decision 2: a document chip confines searches only under a
 * confining focus, so from `broad` or `desk` the button moves focus to
 * `attached`. `attached` and `selection` already confine and are kept.
 */
export function focusForDocument(focus) {
  return focus === 'broad' || focus === 'desk' ? 'attached' : focus;
}

/** How many distinct attached documents a confined search covers. */
export function confiningCount(attachments, indexed) {
  const seen = new Set();
  for (const a of attachments || []) {
    if (coverageOf(a, indexed) !== 'full') continue;
    seen.add(a.kind === 'document' ? `id:${a.document_id}` : `key:${a.document_key}`);
  }
  return seen.size;
}

/** The one-line notice after "Ask about this document". */
export function documentNotice({ switched, count, hi = false }) {
  const many = count > 1;
  if (hi) {
    const n = many ? ` ${count} संलग्न दस्तावेज़ों में खोज।` : '';
    return switched ? `फोकस “केवल संलग्न” पर सेट किया गया, ताकि प्रश्न केवल संलग्न दस्तावेज़ों में खोजें।${n}` : `दस्तावेज़ संलग्न किया गया।${n}`;
  }
  const n = many ? ` Searching ${count} attached documents.` : '';
  return switched ? `Focus set to Attached so questions search only the attached documents.${n}` : `Document attached.${n}`;
}

/**
 * Attaches the cited document and says what the next question will search.
 * Null when nothing was attached: an unusable citation, or a thread that is
 * locked (attach refuses then), in which case focus is left alone.
 */
export async function askAboutDocument(citation, { attach, focus, attachments = [], indexed = null, hi = false }) {
  const chip = documentChip(citation);
  if (!chip || !await attach(async () => [chip])) return null;
  const next = focusForDocument(focus);
  const count = confiningCount([...attachments, chip], indexed);
  return { focus: next, notice: documentNotice({ switched: next !== focus, count, hi }) };
}

function Ico({ name, size = 16 }) {
  const s = size;
  const common = {
    width: s,
    height: s,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  switch (name) {
    case 'sparkles':
      return (
        <svg {...common}>
          <path d="M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3z" fill="currentColor" stroke="none" />
          <path d="M19 13l.7 2.1L22 16l-2.3.7L19 19l-.7-2.3L16 16l2.3-.9L19 13z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'doc':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V9z" />
          <path d="M14 3v6h6M9 13h6M9 17h4" />
        </svg>
      );
    case 'doc-plus':
      return (
        <svg {...common} strokeWidth="1.6">
          <path d="M13 3H7a2 2 0 00-2 2v14a2 2 0 002 2h8a2 2 0 002-2V9z" />
          <path d="M13 3v6h6" />
          <path d="M10 14h4M12 12v4" />
        </svg>
      );
    case 'table':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
        </svg>
      );
    case 'clip':
      return (
        <svg {...common}>
          <path d="M21 12.5l-8.2 8.2a5 5 0 01-7.1-7.1l9.2-9.2a3.2 3.2 0 014.5 4.5L10.2 18" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M3.4 20.6l17.8-8.1c.8-.4.8-1.5 0-1.9L3.4 2.5c-.7-.3-1.4.3-1.2 1l1.7 6.5c.1.4.4.7.8.8l8.1 1.2-8.1 1.2c-.4.1-.7.4-.8.8L2.2 19.6c-.2.7.5 1.3 1.2 1z" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...common}>
          <path d="M6 14l6-6 6 6" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12l4 4L19 6" />
        </svg>
      );
    case 'export':
      return (
        <svg {...common}>
          <path d="M12 3v12M8 7l4-4 4 4M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5" />
        </svg>
      );
    case 'info':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6M12 7h.01" />
        </svg>
      );
    case 'history':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    default:
      return null;
  }
}

const FOCUS_KEY = 'niyantranAiFocus';

/**
 * Keeps the coverage badge current for the attached record keys (admin-upload Amendment A, D9).
 * When the attached set changes, its keys are re-queried at once (`refresh`), so a document an
 * admin just linked or unlinked shows without a reload; while any keyed attachment remains, the
 * keys are re-checked every `every` ms (`recheck` asks about every key whatever its age, since
 * the tick drifts against the answers' lifetime, and keeps the last answer if the lookup fails).
 * Answers arriving after the returned stop function ran are dropped. Returns null, starting
 * nothing, when no key is attached.
 * @param {string} attachedKeys  document keys joined with U+0000, as the panel builds them
 * @param {(indexed: Set<string>) => void} onAnswer
 */
export function watchCoverage(attachedKeys, onAnswer, { refresh = refreshCoverage, recheck = recheckCoverage, every = COVERAGE_TTL_MS } = {}) {
  const keys = String(attachedKeys || '').split('\u0000').filter(Boolean);
  if (!keys.length) return null;
  let alive = true;
  const ask = (lookup) => { lookup(keys).then((set) => { if (alive) onAnswer(set); }).catch(() => {}); };
  ask(refresh);
  const id = setInterval(() => ask(recheck), every);
  return () => { alive = false; clearInterval(id); };
}

export default function AiPanel({ feed, selected, tab, featureName, lang, seed, onSeedConsumed, compact, onClose, open = true }) {
  const hi = lang === 'hi';
  const research = useResearchThread(true);
  const state = research.store;
  const draft = research.draft;
  const setDraft = research.actions.setDraft;
  const busy = research.locked;
  const err = research.error;
  const [dragOver, setDragOver] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  // The model whose reasoning rungs are expanded in the picker, '' for none.
  // Held here rather than in ModelPicker so that stays a function of its props.
  const [effortsOpenFor, setEffortsOpenFor] = useState('');
  // The attached records whose text is in the corpus. Null until the first
  // lookup answers, so a chip shows nothing rather than guessing "Record only".
  const [indexedKeys, setIndexedKeys] = useState(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The chat whose delete is waiting to be confirmed, '' for none. Deleting a
  // conversation removes its messages with it (chat_messages cascades on the
  // conversation) and cannot be undone, so it does not happen on one click.
  const [pendingDelete, setPendingDelete] = useState('');
  // What the last "Ask about this document" did to the search scope, '' for none.
  const [scopeNotice, setScopeNotice] = useState('');
  const [focus, setFocus] = useState(() => {
    try {
      return localStorage.getItem(FOCUS_KEY) || 'attached';
    } catch {
      return 'attached';
    }
  });
  const viewer = research.viewer;
  // The Work mode control is the viewer (streaming spec §G): its selected
  // state is whether the evidence surface is open.
  const workOn = Boolean(viewer);
  const registry = research.registry;
  // Label for an answer whose served model is not known yet: the registry's
  // default, as the model picker shows it.
  const picked = { label: registry.models.find((m) => m.is_default)?.label || registry.models[0]?.label || 'Niyantran' };
  // One name per model: a saved turn stores only ids, so it is labelled here as the live one is.
  // Stable across renders (panel-loading spec E), so memoised message rows are not redrawn.
  const labelOf = useCallback((id) => registry.models.find((x) => x.model_id === id)?.label || id, [registry.models]);
  const modelChoice = research.choice;
  const seedOwner = useRef(null);
  const scroller = useRef(null);
  const box = useRef(null);
  const fileRef = useRef(null);
  const modelRef = useRef(null);
  const focusRef = useRef(null);
  const historyRef = useRef(null);

  const chat = useMemo(
    () => state.chats.find((c) => c.id === state.activeId) || state.chats[0] || null,
    [state],
  );
  const attachments = chat?.attachments || [];
  const attachedKeys = attachments.map((a) => a.document_key).filter(Boolean).join('\u0000');
  useEffect(() => {
    // panel-loading A: a hidden panel stays mounted; its coverage re-check waits until it reopens.
    if (!open) return undefined;
    const stop = watchCoverage(attachedKeys, setIndexedKeys);
    if (!stop) setIndexedKeys(null);
    return stop ?? undefined;
  }, [attachedKeys, open]);
  const messages = research.messages.filter((m) => m.role !== 'system');
  const emptyThread = messages.length === 0;
  const focusMeta = FOCUS_OPTS.find((o) => o.id === focus) || FOCUS_OPTS[0];

  const stream = research.stream;
  // The turn in flight owns the follow-ups while it is on screen; after that
  // the ones saved with the last assistant message do, the same way the
  // controller falls back to savedSources. Reading only `stream` meant every
  // follow-up was lost on reload, on a chat switch, and on any turn but the
  // newest — the questions were in the database the whole time, unread.
  const followUps = stream?.followUps?.length
    ? stream.followUps
    : [...messages].reverse().find((m) => m.role === 'assistant' && m.followUps?.length)?.followUps || [];
  const streaming = Boolean(stream?.isStreaming);
  const openSource = useCallback((source) => research.actions.openSource(source), [research.actions]);
  const closeViewer = () => research.actions.closeViewer();
  useEffect(() => {
    setDragOver(false); setModelOpen(false); setFocusOpen(false); setHistoryOpen(false); setScopeNotice('');
  }, [research.identityVersion]);

  // .ai-v2-body is the element that scrolls (index.css, .ai-v2-history); the thread opens on its
  // newest message and follows it while the reader is at the bottom (F46).
  const [stick] = useState(() => createStickToBottom(() => scroller.current));
  const seenCount = useRef(0);
  useLayoutEffect(() => {
    stick.reset();
    seenCount.current = 0;
  }, [stick, chat?.id]);
  const messageCount = messages.length;
  // The ticker's clock counts from Send. The question joins the thread only after an await, so
  // until it does the clock counts from when the turn went in flight, never from an older question.
  const inFlight = Boolean(research.live || research.submitting);
  const [flightStart, setFlightStart] = useState(0);
  if (inFlight && !flightStart) setFlightStart(Date.now());
  if (!inFlight && flightStart) setFlightStart(0);
  const lastRole = messages[messageCount - 1]?.role;
  const lastUserAt = [...messages].reverse().find((m) => m.role === 'user')?.at || 0;
  const turnStartedAt = Math.max(flightStart, lastUserAt);
  // In flight while the stream is live, or while the question just sent is the last message: the
  // transport clears the stream as the answer is saved, a moment before `submitting` drops, and the
  // block must not render empty beside the saved answer.
  const showFlight = research.live || (research.submitting && lastRole === 'user');
  // panel-loading A: closing hides the panel and closes any open citation (its outside-click
  // listener goes with it); reopening puts the reader back where they were.
  const closeOnHide = research.actions.closeViewer;
  useEffect(() => {
    if (!open) closeOnHide();
  }, [open, closeOnHide]);
  useLayoutEffect(() => {
    if (open) stick.restore();
  }, [open, stick]);
  useLayoutEffect(() => {
    const sent = messageCount > seenCount.current && lastRole === 'user';
    seenCount.current = messageCount;
    stick.follow({ force: sent });
  }, [stick, messageCount, lastRole, busy, stream?.streamingText]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    // Pills, warnings and badges resize the body after the thread renders.
    const observer = new ResizeObserver(() => stick.follow());
    observer.observe(el);
    if (el.querySelector('.ai-v2-history')) observer.observe(el.querySelector('.ai-v2-history'));
    return () => observer.disconnect();
  }, [stick]);

  useEffect(() => {
    if (!modelOpen && !focusOpen && !historyOpen) return undefined;
    function onDoc(e) {
      if (modelOpen && modelRef.current && !modelRef.current.contains(e.target)) setModelOpen(false);
      if (focusOpen && focusRef.current && !focusRef.current.contains(e.target)) setFocusOpen(false);
      if (historyOpen && historyRef.current && !historyRef.current.contains(e.target)) setHistoryOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [modelOpen, focusOpen, historyOpen]);

  // Closing the list abandons a pending delete: reopening it should not still
  // be holding a loaded question from last time.
  useEffect(() => { if (!historyOpen) setPendingDelete(''); }, [historyOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(FOCUS_KEY, focus);
    } catch {
      /* ignore */
    }
  }, [focus]);

  useEffect(() => {
    if (!seed) { seedOwner.current = null; return undefined; }
    if (!research.ready) return undefined;
    if (seedOwner.current?.seed === seed) return undefined;
    seedOwner.current = { seed, version: research.identityVersion };
    const version = research.identityVersion;
    if (seed.prompt) research.actions.setDraft(seed.prompt);
    void research.actions.attach(async () => {
      const bits = [...(seed.droppedFiles || [])];
      const payload = seed.drop || (seed.row ? { kind: 'row', row: seed.row, feature: featureName, tab }
        : seed.attachFeed && feed ? { kind: 'feed', feature: feed.feature, tab }
        : selected ? { kind: 'row', row: selected, feature: featureName, tab } : null);
      if (payload) bits.push(...await materializeAiDrop(payload, { feed, feature: featureName, tier: tab, selected: seed.row || selected }));
      return bits;
    }).then(applied => {
      if (!applied || research.actions.getSnapshot().identityVersion !== version) return;
      onSeedConsumed?.();
    });
    return undefined;
  }, [seed, feed, featureName, tab, selected, onSeedConsumed, research.ready, research.identityVersion, research.actions]);

  async function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const payload = readAiDrag(e);
    const files = [...(e.dataTransfer?.files || [])];
    await research.actions.attach(async () => [
      ...(payload ? await materializeAiDrop(payload, { feed, feature: featureName, tier: tab, selected }) : []),
      ...await filesFromDrop({ dataTransfer: { files, items: [] } }),
    ]);
  }

  async function onPickFiles(e) {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    await research.actions.attach(() => filesFromDrop({ dataTransfer: { files: list, items: [] } }));
  }

  async function onAskAboutDocument(citation) {
    if (busy) return;
    const result = await askAboutDocument(citation, {
      attach: (materialize) => research.actions.attach(materialize),
      focus,
      attachments,
      indexed: indexedKeys,
      hi,
    });
    if (!result) return;
    setFocus(result.focus);
    setScopeNotice(result.notice);
    box.current?.focus();
  }

  function removePin(id) {
    if (!chat || busy) return;
    setChatAttachments(
      chat.id,
      (chat.attachments || []).filter((a) => a.id !== id),
    );
  }

  /**
   * The research path: one streamed turn through the edge function. The
   * selected row travels with its desk identity so the server can confirm it
   * against desk_rows before letting the model cite it, and its document key
   * scopes the turn's first document search to that bill.
   */
  async function sendResearch(text) {
    const current = chat;
    let pins = [...(current?.attachments || [])];

    let selection;
    try { selection = selected && selected.status !== 'source_status' ? researchSelection(selected) : null; }
    catch (error) { research.actions.reportError(error.message); return; }
    // A selection belongs to this turn only: a reload or a click elsewhere
    // drops it. Pinned as a chip, the row stays with the conversation, and its
    // document key keeps scoping later turns to the bill. The older chat path
    // always pinned it; this one sent the selection and forgot it, so a
    // follow-up asked after a reload - with only the module attached - searched
    // the whole record.
    if (selection && !rowIsPinned(pins, selected)) {
      const bits = await materializeAiDrop(
        { kind: 'row', row: selected, feature: featureName, tab, title: rowTitle(selected) },
        { feed, feature: featureName, tier: tab, selected, hydrate: false },
      );
      if (await research.actions.attach(async () => bits)) pins = [...pins, ...bits];
    }
    const sendsSelection = Boolean(selection && featureName);
    const body = {
      ...(current?.id ? { conversation_id: current.id } : {}),
      message: text,
      focus,
      ...(modelChoice.modelId ? { model: modelChoice.modelId } : {}),
      // An explicit value always, including 'off': the server reads an omitted
      // field as its own default, so omission can no longer mean "no reasoning".
      ...(modelChoice.effort ? { reasoning: modelChoice.effort } : {}),
      ...(selection && featureName
        ? {
            selection: {
              tier: tab || '',
              feature: featureName,
              row: selection,
              ...(billDocumentKey(selected) ? { document_key: billDocumentKey(selected) } : {}),
            },
          }
        : {}),
      // The selected row's own chip is left out while the selection is sent: the
      // selection carries the same record and key, verified against desk_rows.
      attachments: requestAttachments(pins.filter((a) => !(sendsSelection && rowIsPinned([a], selected)))),
      ...(featureName || tab ? { desk_context: { tier: tab || '', ...(featureName ? { feature: featureName } : {}) } } : {}),
    };

    await research.actions.send(body);
  }
  async function send(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy || streaming) return;
    setScopeNotice('');
    await sendResearch(text);
  }

  const suggestions = useMemo(
    () => contextualPrompts({ attachments: chat?.attachments, selected, featureName }),
    [chat?.attachments, selected, featureName],
  );

  const docs = [
    ...(hi ? DOCS_HI : DOCS_EN),
    hi ? DOCS_WORK_HI : DOCS_WORK_EN,
  ];

  // R6 decision 7: the viewer opens in the citation overlay, beside the chat rather than over it.
  // The chat keeps its place in the tree whether the overlay is open or not (CitationOverlay), so
  // this component and its research hook are never remounted by opening a citation.
  const evidence = viewer ? (
    <WorkSurface viewer={viewer} sources={research.sources} onOpen={openSource} onClose={closeViewer} onAskAboutDocument={onAskAboutDocument} locked={busy} />
  ) : null;

  // R6 revision 5, point 1: a click outside the open overlay closes the citation and then the chat
  // (the dock's close; a host without one keeps the chat). "← Back" and ✕ close the citation only.
  const closeAll = () => {
    closeViewer();
    onClose?.();
  };

  return (
    <CitationOverlay open={Boolean(viewer)} viewer={evidence} onOutside={closeAll}>
    <div
      className={`ai-shell ai-shell-v2 ai-shell-research${compact ? ' compact' : ''}${dragOver ? ' drop' : ''}${historyOpen ? ' history-open' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="ai-panel-background">
      <header className="ai-v2-head">
        <div className="ai-v2-title">
          <Ico name="sparkles" size={18} />
          <b>{hi ? 'एआई अनुसंधान' : 'AI Research'}</b>
        </div>
        <div className="ai-v2-head-actions">
          <button
            type="button"
            className="ai-v2-icon-btn"
            disabled={busy}
            aria-label={hi ? 'नया अनुसंधान' : 'New research'}
            title={hi ? 'नया अनुसंधान' : 'New research'}
            onClick={() => {
              research.actions.newChat();
              setHistoryOpen(false);
              setDocsOpen(false);
              setModelOpen(false);
              setFocusOpen(false);
            }}
          >
            <Ico name="plus" size={15} />
          </button>
          <div className="ai-v2-history-wrap" ref={historyRef}>
            <button
              type="button"
              className={`ai-v2-icon-btn${historyOpen ? ' on' : ''}`}
              aria-expanded={historyOpen}
              aria-label={hi ? 'चैट इतिहास' : 'Chat history'}
              title={hi ? 'चैट इतिहास' : 'Chat history'}
              onClick={() => {
                setHistoryOpen((v) => !v);
                setDocsOpen(false);
                setModelOpen(false);
                setFocusOpen(false);
              }}
            >
              <Ico name="history" size={15} />
            </button>
            {historyOpen ? (
              <>
                <button
                  type="button"
                  className="ai-v2-history-scrim"
                  aria-label={hi ? 'बंद करें' : 'Close history'}
                  onClick={() => setHistoryOpen(false)}
                />
                <div className="ai-v2-history-pop" role="dialog" aria-label={hi ? 'चैट इतिहास' : 'Chat history'}>
                  <div className="ai-v2-history-pop-head">
                    <b>{hi ? 'इतिहास' : 'History'}</b>
                    <span className="ai-v2-history-count">
                      {(state.chats || []).length}{' '}
                      {(state.chats || []).length === 1 ? (hi ? 'चैट' : 'chat') : hi ? 'चैट' : 'chats'}
                    </span>
                  </div>
                  <ul className="ai-v2-history-list">
                    {(state.chats || []).length ? (
                      (state.chats || []).map((c) => {
                        const n = (c.messages || []).length;
                        const when = c.updatedAt || c.createdAt;
                        const stamp = when
                          ? new Date(when).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '';
                        if (c.id === pendingDelete) {
                          return (
                            <li key={c.id} className="ai-v2-history-confirm">
                              <p>
                                {hi
                                  ? `“${c.title || 'नया अनुसंधान'}” और इसके ${n} संदेश हमेशा के लिए हटाएँ?`
                                  : `Delete “${c.title || 'New research'}” and its ${n} ${n === 1 ? 'message' : 'messages'}? This cannot be undone.`}
                              </p>
                              <div>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    research.actions.deleteChat(c.id);
                                    setPendingDelete('');
                                  }}
                                >
                                  {hi ? 'हटाएँ' : 'Delete'}
                                </button>
                                <button type="button" onClick={(e) => { e.stopPropagation(); setPendingDelete(''); }}>
                                  {hi ? 'रहने दें' : 'Cancel'}
                                </button>
                              </div>
                            </li>
                          );
                        }
                        return (
                          <li key={c.id} className={c.id === chat?.id ? 'on' : ''}>
                            <button
                              type="button"
                              className="ai-v2-history-item"
                              onClick={() => {
                                research.actions.selectChat(c.id);
                                setHistoryOpen(false);
                              }}
                            >
                              <em>{c.title || (hi ? 'नया अनुसंधान' : 'New research')}</em>
                              <small>
                                {stamp}
                                {n ? ` · ${n} ${hi ? 'संदेश' : n === 1 ? 'message' : 'messages'}` : ''}
                              </small>
                            </button>
                            {(state.chats || []).length > 1 ? (
                              <button
                                type="button"
                                className="ai-v2-history-del"
                                aria-label={hi ? 'हटाएँ' : 'Delete'}
                                title={hi ? 'हटाएँ' : 'Delete'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingDelete(c.id);
                                }}
                              >
                                ×
                              </button>
                            ) : null}
                          </li>
                        );
                      })
                    ) : (
                      <li className="ai-v2-history-empty">{hi ? 'अभी कोई चैट नहीं' : 'No chats yet'}</li>
                    )}
                  </ul>
                </div>
              </>
            ) : null}
          </div>
          <button
            type="button"
            className={`ai-v2-icon-btn${docsOpen ? ' on' : ''}`}
            aria-expanded={docsOpen}
            aria-label={hi ? 'दस्तावेज़' : 'Docs'}
            title={hi ? 'दस्तावेज़' : 'How AI research works'}
            onClick={() => setDocsOpen((v) => !v)}
          >
            <Ico name="info" size={15} />
          </button>
          <button
            type="button"
            className="ai-v2-icon-btn"
            aria-label={hi ? 'निर्यात' : 'Download'}
            title={hi ? 'डाउनलोड अभी बंद है' : 'Downloads disabled for now'}
            disabled
          >
            <Ico name="export" size={15} />
          </button>
          {onClose ? (
            <button type="button" className="ai-v2-close" onClick={onClose} aria-label={hi ? 'बंद करें' : 'Close'}>
              ×
            </button>
          ) : null}
        </div>
      </header>

      <div className="ai-v2-chrome">
        <div className={`ai-v2-docs${docsOpen ? '' : ' hide'}`} role="note" hidden={!docsOpen}>
          <b>{hi ? 'एआई अनुसंधान कैसे काम करता है' : 'How AI research works'}</b>
          <ul>
            {docs.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="ai-v2-toolbar" aria-label={hi ? 'चैट विकल्प' : 'Chat options'}>
          <button type="button" className="ai-v2-attach-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Ico name="clip" size={14} />
            {hi ? 'फ़ाइलें जोड़ें' : 'Attach files'}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.csv,.txt,.json,.png,.jpg,.jpeg,.webp"
            onChange={onPickFiles}
          />
          <div className="ai-v2-focus" ref={focusRef}>
            <button
              type="button"
              className={`ai-v2-tool-btn${focusOpen ? ' open' : ''}`}
              aria-expanded={focusOpen}
              onClick={() => {
                setFocusOpen((v) => !v);
                setModelOpen(false);
              }}
            >
              <span className="ai-v2-tool-k">{hi ? 'फोकस' : 'Focus'}</span>
              <span className="ai-v2-tool-v">{hi ? focusMeta.hi : focusMeta.en}</span>
              <Ico name="chevron" size={12} />
            </button>
            {focusOpen ? (
              <div className="ai-v2-pop" role="listbox" aria-label={hi ? 'फोकस' : 'Focus'}>
                {FOCUS_OPTS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={o.id === focus}
                    className={`ai-v2-pop-opt${o.id === focus ? ' on' : ''}`}
                    onClick={() => {
                      setFocus(o.id);
                      setFocusOpen(false);
                      setScopeNotice('');
                    }}
                  >
                    <span>{hi ? o.hi : o.en}</span>
                    <small>{o.hint}</small>
                    {o.id === focus ? <Ico name="check" size={14} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className={`ai-v2-work${workOn ? ' on' : ''}`}
            aria-pressed={workOn}
            title={
              workOn
                ? hi
                  ? 'Work mode — उत्तर पर लौटें'
                  : 'Work mode — back to the answer'
                : hi
                  ? 'Work mode — उत्तर के स्रोत खोलें'
                  : 'Work mode — open the evidence behind the answer'
            }
            onClick={() => {
              // The button is the viewer: answers are evidence-first either way.
              if (viewer) closeViewer();
              else openSource(null);
            }}
          >
            Work mode
          </button>
        </div>
      </div>

      <div ref={scroller} className="ai-v2-body" onScroll={() => stick.onScroll()}>
        <div className={`ai-v2-drop${dragOver ? ' on' : ''}${attachments.length ? ' has-files' : ''}`}>
          <Ico name="doc-plus" size={28} />
          <p>{hi ? 'तालिका से पंक्ति खींचें — या फ़ाइलें यहाँ छोड़ें' : 'Drag a row from the table — or drop files here'}</p>
        </div>

        {attachments.length > 0 ? (
          <ul className="ai-v2-files">
            {attachments.map((a) => {
              const cover = coverageOf(a, indexedKeys);
              const module = isModuleAttachment(a);
              return (
                <li key={a.id} className={module ? 'module' : undefined}>
                  <Ico name={module ? 'table' : 'doc'} size={15} />
                  <span title={a.title}>{a.title}</span>
                  {/* A corpus document attached from the reader: a pointer that
                      confines searches to it, not text pasted into the chat. */}
                  {a.kind === 'document' ? (
                    <em className="ai-v2-file-cover document"
                      title={hi
                        ? 'संलग्न दस्तावेज़: फोकस “केवल संलग्न” या “चयन” होने पर खोज इसी तक सीमित रहती है'
                        : 'An attached document: under Attached or Selection focus, searches are limited to it'}>
                      {hi ? 'दस्तावेज़' : 'Document'}
                    </em>
                  ) : null}
                  {/* A module's name reads like a bill's in this row, and it
                      names no document, so it cannot hold a search to one. */}
                  {module ? (
                    <em className="ai-v2-file-cover module"
                      title={hi
                        ? 'पूरा मॉड्यूल: मॉडल को कुछ नमूना पंक्तियाँ मिलती हैं, किसी विधेयक का पाठ नहीं। एक विधेयक पर पूछने के लिए उसकी पंक्ति यहाँ खींचें।'
                        : 'A whole module: the model gets a few sample rows, not any bill\'s text. To ask about one bill, drag its row here.'}>
                      {hi ? 'मॉड्यूल' : 'Module'}
                    </em>
                  ) : null}
                  {/* What kind of answer this record can give, before the
                      question rather than after it. */}
                  {cover ? (
                    <em className={`ai-v2-file-cover${cover === 'full' ? ' full' : ''}`}
                      title={cover === 'full'
                        ? hi ? 'इस रिकॉर्ड का पूरा पाठ अनुक्रमित है' : 'The full text of this record is indexed and can be quoted'
                        : hi ? 'केवल तालिका पंक्ति — इस रिकॉर्ड का पाठ अनुक्रमित नहीं है' : 'Only the desk row is on file; this record has no indexed text to read'}>
                      {cover === 'full' ? (hi ? 'पूर्ण पाठ' : 'Full text') : (hi ? 'केवल रिकॉर्ड' : 'Record only')}
                    </em>
                  ) : null}
                  <button type="button" aria-label="Remove" onClick={() => removePin(a.id)}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="ai-v2-history">
          {/* panel-loading spec C: until the thread is in, a placeholder of fixed shape holds its place. */}
          {!research.ready && !research.error ? (
            <div className="ai-thread-skeleton" aria-hidden="true">
              <span /><span /><span />
            </div>
          ) : null}
          {messages.map((m) => (
            <MessageRow key={m.id} m={m} lang={lang} fallbackLabel={picked.label} labelOf={labelOf} onOpenSource={openSource} />
          ))}

          {/* The turn in flight: the ticker, then the answer as it is written. */}
          {showFlight && !stream?.error && !research.error ? (
            <div className="ai-msg ai-msg-assistant">
              <span>{stream?.model?.served ? labelOf(stream.model.served) : registry.models.find((x) => x.model_id === modelChoice.modelId)?.label || picked.label}</span>
              {/* One indicator from Send (thinking-display spec §1): the ticker opens at once on
                  "Starting…" and runs until the turn ends; the NyAI card it replaced covered only
                  the client's identity re-check before a differently sized ticker took over. */}
              <ActivityTicker
                activity={stream?.activity || []}
                active={Boolean(research.submitting || streaming || stream?.isPending)}
                startedAt={turnStartedAt}
                model={stream?.model}
                timing={stream?.timing}
                usage={stream?.usage}
                labelOf={labelOf}
                sourceCount={(stream?.sources || []).filter(isReadableCitation).length}
                lang={lang}
              />
              {stream?.streamingText ? (
                <AiMarkdown text={stream.streamingText} sources={stream.sources || []} streaming={streaming} onOpenSource={openSource} />
              ) : null}
            </div>
          ) : null}

          {stream?.notice?.kind === 'window' ? (
            <p className="ai-foot">
              {hi
                ? `पुराने ${stream.notice.dropped} संदेश इस उत्तर के संदर्भ से बाहर थे।`
                : `The ${stream.notice.dropped} oldest messages fell outside this answer's context.`}
            </p>
          ) : null}

          {emptyThread && !busy && research.ready ? (
            <p className="ai-v2-empty muted">
              {hi
                ? 'चैट खाली है। पंक्ति या फ़ाइल जोड़ें, फिर Send दबाएँ।'
                : 'Chat is empty. Attach a row or file, then press Send.'}
            </p>
          ) : null}
        </div>

      </div>

      <div className="ai-v2-foot">
        {/* Starters on an empty thread, the answer's follow-ups after that.
            In the foot, not the body: the body is the scroller, and a row at
            the end of it is only reachable by scrolling to the end of the
            answer. The foot is its own grid row, so the questions stay put
            above the composer however long the answer runs. */}
        {research.ready ? (
          <SuggestionPills
            questions={emptyThread ? suggestions : followUps}
            disabled={busy}
            held={busy || streaming}
            label={
              emptyThread
                ? hi ? 'सुझाए गए प्रश्न' : 'Suggested questions'
                : hi ? 'आगे के प्रश्न' : 'Follow-up questions'
            }
            onPick={(q) => {
              setDraft(q);
              box.current?.focus();
            }}
          />
        ) : null}
        {scopeNotice ? <p className="ai-foot" role="status">{scopeNotice}</p> : null}
        <div className="ai-research-controls" aria-live="polite">
          {research.loading ? <span>Loading research…</span> : null}
          {stream?.status === 'unknown' ? <span>Connection lost. The saved outcome is unknown.</span> : null}
          {research.storedRunning || stream?.status === 'running' && !streaming ? <span>Research is running.</span> : null}
          {research.cancelRequested || stream?.cancelRequested ? <span>Stopping — awaiting the saved result.</span> : null}
          {research.cancelError || stream?.cancelError ? <span role="alert">{research.cancelError || stream.cancelError}</span> : null}
          {research.recoverable ? <button type="button" onClick={() => research.actions.recover()}>Recover answer</button> : null}
          <button type="button" disabled={research.loading} onClick={() => research.actions.reload()}>Reload</button>
        </div>
        {err || stream?.error ? (
          <p className="ai-foot warn" role="alert">{err || stream?.error}</p>
        ) : null}
        <form className="ai-v2-composer" onSubmit={send}>
          <textarea
            ref={box}
            rows={2}
            value={draft}
            disabled={busy}
            aria-label={hi ? 'आपका प्रश्न' : 'Your question'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // isComposing: Enter while an IME candidate window is open commits
              // the candidate, it does not end the sentence. Sending there would
              // post half a word in Hindi, Japanese or Chinese.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={hi ? 'अपनी फ़ाइलों के बारे में पूछें…' : 'Ask a question about your files...'}
          />
          {/* Under the text and inside the box: choosing a model is part of
              composing the message, not chrome standing beside it. What and how
              on the left, do-it on the right. */}
          <div className="ai-v2-comp-bar">
            <div className="ai-v2-comp-tools">
              <button
                type="button"
                className="ai-v2-comp-clip"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                aria-label={hi ? 'फ़ाइल जोड़ें' : 'Attach a file'}
                title={hi ? 'फ़ाइल जोड़ें' : 'Attach a file'}
              >
                <Ico name="clip" size={16} />
              </button>
          <div ref={modelRef}>
            <ModelPicker
              pending={!research.ready}
              models={registry.models}
              roles={registry.roles}
              value={modelChoice}
              open={modelOpen}
              effortsOpenFor={effortsOpenFor}
              onToggleEfforts={setEffortsOpenFor}
              onToggle={() => {
                setModelOpen((v) => !v);
                setFocusOpen(false);
                setEffortsOpenFor('');
              }}
              onChange={(next) => research.actions.setChoice(next)}
            />
          </div>
            </div>

            <div className="ai-v2-comp-act">
              {research.canStop ? (
                <button
                  type="button"
                  className="ai-v2-send stop"
                  aria-label={hi ? 'रोकें' : 'Stop'}
                  title={hi ? 'रोकें' : 'Stop'}
                  disabled={research.cancelPending || stream?.cancelPending}
                  onClick={() => research.actions.stop()}
                >
                  ■
                </button>
              ) : null}
              <button className="ai-v2-send" type="submit" disabled={busy || streaming || !draft.trim()} aria-label={hi ? 'भेजें' : 'Send'} hidden={streaming}>
                <Ico name="send" size={16} />
              </button>
            </div>
          </div>
        </form>
      </div>
      </div>
    </div>
    </CitationOverlay>
  );
}
