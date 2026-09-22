import { useEffect, useMemo, useRef, useState } from 'react';
import { sendAiChat } from '../lib/aiClient.js';
import {
  activeAiChat,
  addChatAttachments,
  appendAiMessage,
  createAiChat,
  deleteAiChat,
  ensureAiChat,
  serverThreads,
  setActiveAiChat,
  setChatAttachments,
  setChatRole,
  subscribeAiChats,
} from '../lib/aiThreads.js';
import { AI_PROVIDERS, activeAiProvider, shortModelLabel } from '../lib/aiModelsStore.js';
import { sessionUser } from '../lib/userStore.js';
import { filesFromDrop, materializeAiDrop, openAiResearch, readAiDrag } from '../lib/aiDrop.js';
import { rowPinKey } from '../lib/sourceUrls.js';
import { billDocumentKey, deskRowKey } from '../lib/deskRows.js';
import { coverageOf, indexedDocumentKeys } from '../lib/corpusCoverage.js';
import useResearchThread from './useResearchThread.js';
import './research.css';
import { AiBrandIcon } from './AiBrandIcon.jsx';
import AiMarkdown from './AiMarkdown.jsx';
import ActivityTicker from './ActivityTicker.jsx';
import ModelPicker from './ModelPicker.jsx';
import SourceList from './SourceList.jsx';
import SuggestionPills from './SuggestionPills.jsx';
import WorkSurface from './WorkSurface.jsx';
import { isReadableCitation } from './CitationBubble.jsx';
import { trackProductEvent } from '../lib/productAnalytics.js';

const FOCUS_OPTS = [
  { id: 'attached', en: 'Attached only', hi: 'केवल संलग्न', hint: 'Pins and files in this chat' },
  { id: 'selection', en: 'Selection + pins', hi: 'चयन + पिन', hint: 'Selected desk row plus attachments' },
  { id: 'desk', en: 'Desk sample', hi: 'डेस्क नमूना', hint: 'A few rows from the open module plus pins' },
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
const DOCS_FLAG_EN = 'Work mode keeps replies denser: Evidence → Read → Gaps → Confidence.';
const DOCS_FLAG_HI = 'Work mode घने उत्तर रखता है: Evidence → Read → Gaps → Confidence।';

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

function slimRow(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    out[k] = String(v).slice(0, 500);
  }
  if (!Object.keys(out).length) return null;
  out.record_text = Object.entries(out)
    .filter(([k]) => k !== 'record_text')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
    .slice(0, 4_000);
  return out;
}

function buildDeskContext(feed, tab, featureName) {
  if (!feed) return null;
  const rows = (feed.rows || []).filter((r) => r && r.status !== 'source_status').slice(0, 8).map(slimRow).filter(Boolean);
  return {
    feature: featureName || feed.feature || '',
    tab: tab || feed.tier || '',
    note: feed.fallback ? 'Desk is on a labelled fallback / archive pass.' : '',
    rows,
  };
}

function exportChatMarkdown(chat, picked) {
  const lines = [
    `# ${chat?.title || 'AI research'}`,
    '',
    `_Exported from Niyantran · model ${picked?.label || ''} · ${new Date().toISOString()}_`,
    '',
  ];
  for (const m of chat?.messages || []) {
    if (m.role === 'system') continue;
    const who = m.role === 'user' ? 'You' : m.model || 'Assistant';
    lines.push(`## ${who}`);
    lines.push('');
    lines.push(String(m.content || ''));
    lines.push('');
  }
  const pins = chat?.attachments || [];
  if (pins.length) {
    lines.push('## Attachments');
    lines.push('');
    for (const a of pins) lines.push(`- ${a.title || a.feature || a.kind}`);
    lines.push('');
  }
  return lines.join('\n');
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

function pickRoleForProvider(id) {
  if (id === 'gpt-astra') return 'EXPERT_ESCALATION';
  if (id === 'gemini-flash') return 'VISUAL_RESEARCH';
  return 'DEFAULT_ANALYST';
}

const RECOMMENDED_IDS = ['gemini-lite', 'gemini-flash'];
const FOCUS_KEY = 'niyantranAiFocus';
const WORK_KEY = 'niyantranAiWorkMode';

export default function AiPanel({ feed, selected, tab, featureName, lang, seed, onSeedConsumed, compact, onClose }) {
  const hi = lang === 'hi';
  const research = useResearchThread(serverThreads);
  const [legacyState, setState] = useState(() => serverThreads ? { chats: [], activeId: '' } : ensureAiChat());
  const state = serverThreads ? research.store : legacyState;
  const [providerId, setProviderId] = useState(() => activeAiProvider().id);
  const [legacyDraft, setLegacyDraft] = useState('');
  const [legacyBusy, setBusy] = useState(false);
  const [legacyError, setErr] = useState('');
  const draft = serverThreads ? research.draft : legacyDraft;
  const setDraft = serverThreads ? research.actions.setDraft : setLegacyDraft;
  const busy = serverThreads ? research.locked : legacyBusy;
  const err = serverThreads ? research.error : legacyError;
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
  const [focus, setFocus] = useState(() => {
    try {
      return localStorage.getItem(FOCUS_KEY) || 'attached';
    } catch {
      return 'attached';
    }
  });
  const [workMode, setWorkMode] = useState(() => {
    try {
      return localStorage.getItem(WORK_KEY) === '1';
    } catch {
      return false;
    }
  });
  const viewer = serverThreads ? research.viewer : null;
  // What the Work mode control is showing as. On the research path the button
  // is the viewer (streaming spec §G), so its selected state is the viewer's -
  // `workMode` is the legacy prompt flag and that path never writes it, which
  // is why clicking a citation used to open the surface with the tab unlit.
  const workOn = serverThreads ? Boolean(viewer) : workMode;
  const registry = research.registry;
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
  const picked = AI_PROVIDERS.find((p) => p.id === providerId && p.enabled) || activeAiProvider();
  const attachments = chat?.attachments || [];
  const attachedKeys = attachments.map((a) => a.document_key).filter(Boolean).join(' ');
  useEffect(() => {
    if (!serverThreads || !attachedKeys) { setIndexedKeys(null); return; }
    let alive = true;
    indexedDocumentKeys(attachedKeys.split(' ')).then((set) => { if (alive) setIndexedKeys(set); }).catch(() => {});
    return () => { alive = false; };
  }, [attachedKeys]);
  const messages = (serverThreads ? research.messages : chat?.messages || []).filter((m) => m.role !== 'system');
  const emptyThread = messages.length === 0;
  const focusMeta = FOCUS_OPTS.find((o) => o.id === focus) || FOCUS_OPTS[0];

  useEffect(() => serverThreads ? undefined : subscribeAiChats(setState), []);
  useEffect(() => {
    const live = activeAiProvider().id;
    if (!AI_PROVIDERS.find((p) => p.id === providerId)?.enabled) setProviderId(live);
  }, [providerId]);

  const stream = serverThreads ? research.stream : null;
  // The turn in flight owns the follow-ups while it is on screen; after that
  // the ones saved with the last assistant message do, the same way the
  // controller falls back to savedSources. Reading only `stream` meant every
  // follow-up was lost on reload, on a chat switch, and on any turn but the
  // newest — the questions were in the database the whole time, unread.
  const followUps = serverThreads
    ? stream?.followUps?.length
      ? stream.followUps
      : [...messages].reverse().find((m) => m.role === 'assistant' && m.followUps?.length)?.followUps || []
    : [];
  const streaming = Boolean(stream?.isStreaming);
  const openSource = source => research.actions.openSource(source);
  const closeViewer = () => research.actions.closeViewer();
  useEffect(() => {
    if (!serverThreads) return;
    setDragOver(false); setModelOpen(false); setFocusOpen(false); setHistoryOpen(false);
  }, [research.identityVersion]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [chat?.messages?.length, busy]);

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

  useEffect(() => {
    try {
      localStorage.setItem(FOCUS_KEY, focus);
    } catch {
      /* ignore */
    }
  }, [focus]);

  useEffect(() => {
    try {
      localStorage.setItem(WORK_KEY, workMode ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [workMode]);

  useEffect(() => {
    if (!seed) { seedOwner.current = null; return undefined; }
    if (serverThreads) {
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
    }
    if (seed.attachFeed && !feed && !seed.row && !seed.drop && !seed.droppedFiles?.length) return undefined;
    let cancelled = false;
    (async () => {
      const st = ensureAiChat();
      const id = st.activeId;
      if (seed.drop) {
        const bits = await materializeAiDrop(seed.drop, {
          feed,
          feature: featureName,
          tier: tab,
          selected,
        });
        if (!cancelled) addChatAttachments(id, bits);
      }
      if (seed.droppedFiles?.length && !cancelled) addChatAttachments(id, seed.droppedFiles);
      if (seed.row) {
        const bits = await materializeAiDrop(
          {
            kind: 'row',
            row: seed.row,
            feature: featureName,
            tab,
            title:
              seed.row.bill_name ||
              seed.row.title ||
              seed.row.name ||
              seed.row.subject ||
              seed.row.conflict_name ||
              seed.row.commodity,
          },
          { feed, feature: featureName, selected: seed.row },
        );
        if (!cancelled) {
          addChatAttachments(id, bits);
          setFocus('selection');
        }
      } else if (seed.attachFeed && feed) {
        const bits = await materializeAiDrop(
          { kind: 'feed', feature: feed.feature, tab },
          { feed, feature: featureName, selected },
        );
        if (!cancelled) {
          addChatAttachments(id, bits);
          if (selected) setFocus('selection');
        }
      } else if (selected && !cancelled) {
        // Any desk: opening AI with a highlighted row still grounds that row.
        const bits = await materializeAiDrop(
          {
            kind: 'row',
            row: selected,
            feature: featureName,
            tab,
            title:
              selected.bill_name ||
              selected.title ||
              selected.name ||
              selected.subject ||
              selected.conflict_name,
          },
          { feed, feature: featureName, selected },
        );
        addChatAttachments(id, bits);
        setFocus('selection');
      }
      if (seed.prompt && !cancelled) setDraft(seed.prompt);
      if (!cancelled) onSeedConsumed?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [seed, feed, featureName, tab, selected, onSeedConsumed, research.ready, research.identityVersion]);

  async function attachDrop(payload) {
    const st = ensureAiChat();
    const bits = await materializeAiDrop(payload, { feed, feature: featureName, tier: tab, selected });
    addChatAttachments(st.activeId, bits);
    openAiResearch();
  }

  async function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (serverThreads) {
      if (viewer) return;
      const payload = readAiDrag(e);
      const files = [...(e.dataTransfer?.files || [])];
      await research.actions.attach(async () => [
        ...(payload ? await materializeAiDrop(payload, { feed, feature: featureName, tier: tab, selected }) : []),
        ...await filesFromDrop({ dataTransfer: { files, items: [] } }),
      ]);
      return;
    }
    const payload = readAiDrag(e);
    if (payload) await attachDrop(payload);
    const dropped = await filesFromDrop(e);
    if (dropped.length) {
      const st = ensureAiChat();
      addChatAttachments(st.activeId, dropped);
    }
  }

  async function onPickFiles(e) {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    if (serverThreads) { await research.actions.attach(() => filesFromDrop({ dataTransfer: { files: list, items: [] } })); return; }
    const dropped = await filesFromDrop({ dataTransfer: { files: list, items: [] } });
    if (dropped.length) {
      const st = ensureAiChat();
      addChatAttachments(st.activeId, dropped);
    }
  }

  function removePin(id) {
    if (!chat || (serverThreads && busy)) return;
    setChatAttachments(
      chat.id,
      (chat.attachments || []).filter((a) => a.id !== id),
    );
  }

  function selectProvider(p) {
    if (!p.enabled) return;
    setProviderId(p.id);
    setModelOpen(false);
    if (chat) setChatRole(chat.id, pickRoleForProvider(p.id));
  }

  function onExport() {
    if (!chat) return;
    try {
      const gate = window.__niyExportGate;
      if (typeof gate === 'function' && gate({ kind: 'ai' }) === false) return;
    } catch {
      /* continue */
    }
    const md = exportChatMarkdown(chat, picked);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(chat.title || 'research')
      .replace(/[^\w\-]+/g, '_')
      .slice(0, 48)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    trackProductEvent('ai_export', {
      chatId: chat.id,
      title: chat.title || '',
      messages: (chat.messages || []).length,
    });
  }

  /**
   * The research path: one streamed turn through the edge function. The
   * selected row travels with its desk identity so the server can confirm it
   * against desk_rows before letting the model cite it, and its document key
   * scopes the turn's first document search to that bill.
   */
  async function sendResearch(text) {
    const current = chat;
    const pins = [...(current?.attachments || [])];

    let selection;
    try { selection = selected && selected.status !== 'source_status' ? researchSelection(selected) : null; }
    catch (error) { research.actions.reportError(error.message); return; }
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
      attachments: pins
        .map((a) => ({
          kind: a.kind === 'row' || a.kind === 'record' ? a.kind : 'file',
          title: String(a.title || a.feature || 'Attachment'),
          text: String(a.text || a.preview?.record_text || ''),
          ...(a.feature ? { feature: a.feature } : {}),
          ...(a.preview ? { row_key: deskRowKey(a.preview) } : {}),
          ...(a.document_key ? { document_key: a.document_key } : {}),
        }))
        .filter((a) => a.text),
      ...(featureName || tab ? { desk_context: { tier: tab || '', ...(featureName ? { feature: featureName } : {}) } } : {}),
    };

    await research.actions.send(body);
  }

  async function send(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy || streaming) return;
    if (serverThreads) {
      await sendResearch(text);
      return;
    }
    const st = ensureAiChat();
    const id = st.activeId;
    const current = activeAiChat();
    let pins = [...(current?.attachments || [])];
    appendAiMessage(id, { role: 'user', content: text });
    setDraft('');
    setErr('');
    setBusy(true);
    try {
      // Every desk: if a table row is selected, ground this turn on its columns + real docs.
      if (selected && selected.status !== 'source_status') {
        const key = rowPinKey(selected);
        const already = pins.some((a) => {
          if (a.kind !== 'row') return false;
          const prev = a.preview || {};
          return rowPinKey(prev) === key || a.title === (selected.bill_name || selected.title || selected.name);
        });
        if (!already) {
          const bits = await materializeAiDrop(
            {
              kind: 'row',
              row: selected,
              feature: featureName,
              tab,
              title:
                selected.bill_name ||
                selected.title ||
                selected.name ||
                selected.subject ||
                selected.conflict_name ||
                selected.commodity ||
                'Selected record',
            },
            { feed, feature: featureName, selected },
          );
          addChatAttachments(id, bits);
          pins = [...pins, ...bits];
        }
      }

      const history = [...(current?.messages || []), { role: 'user', content: text }].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const model = AI_PROVIDERS.find((p) => p.id === providerId && p.enabled) || activeAiProvider();
      const hasRowPin = pins.some((a) => a.kind === 'row' || a.kind === 'feed');
      const useSelection = true;
      const out = await sendAiChat({
        roleId: current?.roleId || 'AUTO',
        messages: history.filter((m) => m.role === 'user' || m.role === 'assistant'),
        attachments: pins,
        userType: sessionUser()?.type,
        model: model.model,
        provider: model.provider,
        focus: hasRowPin && focus === 'attached' ? 'selection' : focus,
        workMode,
        selection: useSelection
          ? slimRow(selected) || pins.find((a) => a.kind === 'row')?.preview || null
          : null,
        deskContext:
          focus === 'desk' || focus === 'broad' ? buildDeskContext(feed, tab, featureName) : null,
      });
      appendAiMessage(id, {
        role: 'assistant',
        content: out.text,
        model: shortModelLabel({ model: out.model, provider: out.provider, id: model.id }) || model.label,
        provider: out.provider,
        roleUsed: out.role?.id,
      });
    } catch (ex) {
      const msg = ex.message || String(ex);
      setErr(msg);
      appendAiMessage(id, { role: 'assistant', content: `Could not complete that pass: ${msg}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  const suggestions = useMemo(
    () => contextualPrompts({ attachments: chat?.attachments, selected, featureName }),
    [chat?.attachments, selected, featureName],
  );

  const recommended = AI_PROVIDERS.filter((p) => RECOMMENDED_IDS.includes(p.id));
  const others = AI_PROVIDERS.filter((p) => !RECOMMENDED_IDS.includes(p.id));
  const docs = [
    ...(hi ? DOCS_HI : DOCS_EN),
    serverThreads ? (hi ? DOCS_WORK_HI : DOCS_WORK_EN) : hi ? DOCS_FLAG_HI : DOCS_FLAG_EN,
  ];

  return (
    <div
      className={`ai-shell ai-shell-v2${serverThreads ? ' ai-shell-research' : ''}${compact ? ' compact' : ''}${dragOver ? ' drop' : ''}${workMode ? ' work' : ''}${historyOpen ? ' history-open' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!serverThreads || (!busy && !viewer)) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* The surface is the Work mode tab's pane, not a cover over the panel:
          only the thread it replaces goes inert, so the tab that closes it and
          the composer stay reachable. */}
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
            disabled={serverThreads && busy}
            aria-label={hi ? 'नया अनुसंधान' : 'New research'}
            title={hi ? 'नया अनुसंधान' : 'New research'}
            onClick={() => {
              if (serverThreads) research.actions.newChat();
              else createAiChat({ roleId: chat?.roleId || 'AUTO' });
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
                        return (
                          <li key={c.id} className={c.id === chat?.id ? 'on' : ''}>
                            <button
                              type="button"
                              className="ai-v2-history-item"
                              onClick={() => {
                                if (serverThreads) research.actions.selectChat(c.id); else setActiveAiChat(c.id);
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
                                  if (serverThreads) research.actions.deleteChat(c.id);
                                  else { deleteAiChat(c.id); ensureAiChat(); }
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
            aria-label={hi ? 'निर्यात' : 'Export'}
            title={hi ? 'चैट निर्यात करें' : 'Export chat as Markdown'}
            disabled={!messages.length}
            onClick={onExport}
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
          <button type="button" className="ai-v2-attach-btn" disabled={serverThreads && busy} onClick={() => fileRef.current?.click()}>
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
              serverThreads
                ? workOn
                  ? hi
                    ? 'Work mode — उत्तर पर लौटें'
                    : 'Work mode — back to the answer'
                  : hi
                    ? 'Work mode — उत्तर के स्रोत खोलें'
                    : 'Work mode — open the evidence behind the answer'
                : workMode
                  ? hi
                    ? 'Work mode चालू — घने, साक्ष्य-पहले उत्तर'
                    : 'Work mode on — dense, evidence-first answers'
                  : hi
                    ? 'Work mode बंद'
                    : 'Work mode off'
            }
            onClick={() => {
              // On the research path the button is the viewer: answers are
              // evidence-first either way, so the flag has nothing left to do.
              if (!serverThreads) {
                setWorkMode((v) => !v);
                return;
              }
              if (viewer) closeViewer();
              else openSource(null);
            }}
          >
            Work mode
          </button>
        </div>
      </div>

      <div className="ai-v2-body" inert={serverThreads && viewer ? true : undefined}>
        <div className={`ai-v2-drop${dragOver ? ' on' : ''}${attachments.length ? ' has-files' : ''}`}>
          <Ico name="doc-plus" size={28} />
          <p>{hi ? 'तालिका से पंक्ति खींचें — या फ़ाइलें यहाँ छोड़ें' : 'Drag a row from the table — or drop files here'}</p>
        </div>

        {attachments.length > 0 ? (
          <ul className="ai-v2-files">
            {attachments.map((a) => {
              const cover = coverageOf(a, indexedKeys);
              return (
                <li key={a.id}>
                  <Ico name="doc" size={15} />
                  <span title={a.title}>{a.title}</span>
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

        <div ref={scroller} className="ai-v2-history">
          {messages.map((m) => (
            <div key={m.id} className={`ai-msg ai-msg-${m.role}${m.error ? ' err' : ''}`}>
              <span>{m.role === 'user' ? (hi ? 'आप' : 'You') : m.model || picked.label}</span>
              {m.role === 'assistant' && (serverThreads || !m.error) ? (
                <>
                  {serverThreads && (m.activity?.length || m.timing || m.model_served) ? <ActivityTicker activity={m.activity} timing={m.timing} usage={m.usage} model={{ requested: m.model_requested, served: m.model_served }} /> : null}
                  <AiMarkdown text={m.content} sources={serverThreads ? m.sources || [] : undefined} onOpenSource={openSource} />
                  {serverThreads && Array.isArray(m.sources) && m.sources.length ? <SourceList sources={m.sources.filter(isReadableCitation)} onOpen={openSource} /> : null}
                  {serverThreads && m.status && m.status !== 'complete' ? <p className="ai-research-status">{m.status === 'running' ? 'Running — use Reload for the saved result.' : m.status}</p> : null}
                  {serverThreads && m.error_message ? <p className="ai-foot warn">{m.error_message}</p> : null}
                </>
              ) : (
                m.content
              )}
            </div>
          ))}

          {/* The turn in flight: the ticker, then the answer as it is written. */}
          {serverThreads && research.live ? (
            <div className="ai-msg ai-msg-assistant">
              <span>{stream?.model?.served || registry.models.find((x) => x.model_id === modelChoice.modelId)?.label || picked.label}</span>
              <ActivityTicker activity={stream?.activity || []} active={streaming} model={stream?.model} timing={stream?.timing} usage={stream?.usage} />
              {stream?.streamingText ? (
                <AiMarkdown text={stream.streamingText} sources={stream.sources || []} streaming={streaming} onOpenSource={openSource} />
              ) : null}
            </div>
          ) : null}

          {serverThreads && stream?.notice?.kind === 'window' ? (
            <p className="ai-foot">
              {hi
                ? `पुराने ${stream.notice.dropped} संदेश इस उत्तर के संदर्भ से बाहर थे।`
                : `The ${stream.notice.dropped} oldest messages fell outside this answer's context.`}
            </p>
          ) : null}

          {!serverThreads && busy ? (
            <div className="ai-msg ai-msg-assistant">
              <span>{picked.label}</span>
              {hi ? 'संलग्न स्रोत पढ़ रहा है…' : 'Reading attached sources…'}
            </div>
          ) : null}
        </div>

      </div>

      <div className="ai-v2-foot">
        {/* Starters on an empty thread, the answer's follow-ups after that.
            In the foot, not the body: the body is the scroller, and a row at
            the end of it is only reachable by scrolling to the end of the
            answer. The foot is its own grid row, so the questions stay put
            above the composer however long the answer runs. */}
        {!busy && !streaming ? (
          <SuggestionPills
            questions={emptyThread ? suggestions : followUps}
            disabled={busy}
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
        {serverThreads ? <div className="ai-research-controls" aria-live="polite">
          {research.loading ? <span>Loading research…</span> : null}
          {stream?.status === 'unknown' ? <span>Connection lost. The saved outcome is unknown.</span> : null}
          {research.storedRunning || stream?.status === 'running' && !streaming ? <span>Research is running.</span> : null}
          {research.cancelRequested || stream?.cancelRequested ? <span>Stopping — awaiting the saved result.</span> : null}
          {research.cancelError || stream?.cancelError ? <span role="alert">{research.cancelError || stream.cancelError}</span> : null}
          {research.recoverable ? <button type="button" onClick={() => research.actions.recover()}>Recover answer</button> : null}
          <button type="button" disabled={research.loading} onClick={() => research.actions.reload()}>Reload</button>
        </div> : null}
        {err ? <p className="ai-foot warn" role="alert">{err}</p> : null}
        <form className="ai-v2-composer" onSubmit={send}>
          <button type="button" className="ai-v2-comp-clip" disabled={serverThreads && busy} onClick={() => fileRef.current?.click()} aria-label="Attach">
            <Ico name="clip" size={16} />
          </button>
          <textarea
            ref={box}
            rows={2}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={hi ? 'अपनी फ़ाइलों के बारे में पूछें…' : 'Ask a question about your files...'}
          />
          {serverThreads && research.canStop ? (
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
        </form>

        <div className="ai-v2-model-row">
          {serverThreads ? (
            <div ref={modelRef}>
              <ModelPicker
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
          ) : null}
          {!serverThreads ? <div className="ai-v2-model" ref={modelRef}>
            <button
              type="button"
              className={`ai-v2-model-btn${modelOpen ? ' open' : ''}`}
              aria-expanded={modelOpen}
              aria-label={hi ? 'मॉडल चुनें' : 'Choose model'}
              onClick={() => {
                setModelOpen((v) => !v);
                setFocusOpen(false);
              }}
            >
              <AiBrandIcon id={picked.provider} size={16} />
              <span>{picked.label.replace(/\s*-\s*/, ' ')}</span>
              <Ico name="chevron" size={14} />
            </button>
            {modelOpen ? (
              <div className="ai-v2-model-menu" role="listbox" aria-label={hi ? 'मॉडल' : 'Model'}>
                <p className="ai-v2-model-sec">{hi ? 'अनुशंसित' : 'Recommended'}</p>
                {recommended.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === picked.id}
                    className={`ai-v2-model-opt${p.id === picked.id ? ' on' : ''}${p.enabled ? '' : ' locked'}`}
                    disabled={!p.enabled}
                    title={p.hint}
                    onClick={() => selectProvider(p)}
                  >
                    <AiBrandIcon id={p.provider} size={16} />
                    <span className="ai-v2-model-copy">
                      <em>{p.label.replace(/\s*-\s*/, ' ')}</em>
                      <small>{p.hint}</small>
                    </span>
                    {p.id === picked.id ? <Ico name="check" size={14} /> : null}
                  </button>
                ))}
                <p className="ai-v2-model-sec">{hi ? 'अन्य मॉडल' : 'Other models'}</p>
                {others.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === picked.id}
                    className={`ai-v2-model-opt${p.id === picked.id ? ' on' : ''}${p.enabled ? '' : ' locked'}`}
                    disabled={!p.enabled}
                    title={p.hint}
                    onClick={() => selectProvider(p)}
                  >
                    <AiBrandIcon id={p.provider} size={16} />
                    <span className="ai-v2-model-copy">
                      <em>{p.label.replace(/\s*-\s*/, ' ')}</em>
                      <small>{p.enabled ? p.hint : p.hint || (hi ? 'अभी उपलब्ध नहीं' : 'Unavailable')}</small>
                    </span>
                    {p.id === picked.id ? <Ico name="check" size={14} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div> : null}
        </div>
      </div>
      {serverThreads && viewer ? <WorkSurface viewer={viewer} sources={research.sources} onOpen={openSource} onClose={closeViewer} /> : null}
      </div>
    </div>
  );
}
