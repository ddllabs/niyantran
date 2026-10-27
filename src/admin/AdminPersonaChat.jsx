import { useEffect, useRef, useState } from 'react';
import { runPersonaProbe } from '../lib/personaProbe.js';
import { userTypeOf } from '../lib/userTypes.js';
import AiMarkdown from '../ai/AiMarkdown.jsx';

const PROBES = {
  student: ['green hydrogen', 'Art. 21 vs Art. 19 — Prelims traps', 'Write a 15-marker on simultaneous elections'],
  journalist: ['Write the lede on the latest RBI MPC decision', 'What is still unverified in this story?', 'List the documents I should pull next'],
  lawyer: ['Legal status of simultaneous elections proposals', 'Pin the holding in Puttaswamy (2017)', 'Is an as-introduced bill law in force?'],
  policy: ['Brief the National Green Hydrogen Mission', 'Who owns PM-JANMAN and what is its funding pattern?', 'Trade-offs in a carbon border adjustment'],
  academic: ['How has anti-defection law been interpreted since 1985?', 'What does the record show on Lok Sabha sitting days over time?', 'Where are the gaps in the evidence on electoral bonds?'],
  analyst: ['What would a carbon border tax touch in Indian industry?', 'Extract the load-bearing facts from this packet', 'Where is the evidence thin?'],
};

export default function AdminPersonaChat({ typeId, promptText, disabled = false }) {
  const meta = userTypeOf(typeId);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [diagnostic, setDiagnostic] = useState(null);
  const request = useRef(null);
  const scroller = useRef(null);
  useEffect(() => {
    request.current?.abort(); request.current = null;
    setMessages([]); setConversationId(null); setDraft(''); setErr(''); setBusy(false); setDiagnostic(null);
    return () => { request.current?.abort(); request.current = null; };
  }, [typeId, promptText]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [messages, busy]);
  async function send(e, preset) {
    e?.preventDefault();
    const text = String(preset || draft).trim();
    if (!text || busy || disabled) return;
    const abort = new AbortController(); request.current = abort;
    setMessages(list => [...list, { role: 'user', content: text }]); setDraft(''); setErr(''); setBusy(true);
    try {
      const out = await runPersonaProbe({ typeId, promptText, message: text, conversationId, signal: abort.signal });
      if (request.current !== abort || abort.signal.aborted) return;
      setConversationId(out.conversationId); setDiagnostic(out.personaMeta || null);
      setMessages(list => [...list, { role: 'assistant', content: out.text, model: out.model }]);
    } catch (e) { if (request.current === abort && !abort.signal.aborted) setErr(e.message); }
    finally { if (request.current === abort) { request.current = null; setBusy(false); } }
  }
  return <section className="adm-mini-chat">
    <header className="adm-mini-head"><div><b>Test current text</b><span>{meta.label} · unsaved edits included · admins only</span></div>
      <button type="button" className="adm-btn ghost tiny" disabled={busy} onClick={() => { setMessages([]); setConversationId(null); setDiagnostic(null); setErr(''); }}>Clear</button>
    </header>
    <div className="adm-mini-log" ref={scroller}>
      {!messages.length && <p className="adm-mini-empty">This tests the exact editor text without publishing. Editing it starts a fresh test conversation. Tests use your account’s normal AI credits.</p>}
      {messages.map((m, i) => <article key={i} className={`adm-mini-msg ${m.role}`}><span>{m.role === 'user' ? 'You' : m.model || 'Niyantran'}</span>{m.role === 'assistant' ? <AiMarkdown text={m.content} /> : <p>{m.content}</p>}</article>)}
      {busy && <p role="status">Testing {meta.short}…</p>}
      {err && <p role="alert">{err}</p>}
    </div>
    {diagnostic && <div className="adm-hint" role="status">Prompt: {diagnostic.source} · version {diagnostic.version || 'unsaved'}<br />SHA-256: <code style={{ overflowWrap: 'anywhere' }}>{diagnostic.hash}</code>{diagnostic.reason && <p>Fallback: {diagnostic.reason}</p>}</div>}
    <div className="adm-mini-probes">{(PROBES[typeId] || PROBES.analyst).map(text => <button type="button" key={text} disabled={busy || disabled} onClick={() => send(null, text)}>{text}</button>)}</div>
    <form className="adm-mini-form" onSubmit={send}>
      <textarea name="persona-message" aria-label={`Message as ${meta.short}`} value={draft} disabled={busy || disabled} onChange={e => setDraft(e.target.value)} />
      <button className="adm-btn" disabled={busy || disabled || !draft.trim()}>Test current text</button>
    </form>
  </section>;
}
