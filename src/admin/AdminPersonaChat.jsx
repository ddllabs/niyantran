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

export default function AdminPersonaChat({ typeId }) {
  const meta = userTypeOf(typeId);
  const [threads, setThreads] = useState({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // research-chat conversation per persona, so follow-ups keep their context.
  const [conversations, setConversations] = useState({});
  const scroller = useRef(null);
  const box = useRef(null);
  const messages = threads[typeId] || [];

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages.length, busy, typeId]);

  useEffect(() => {
    setErr('');
    setDraft('');
  }, [typeId]);

  function setThread(next) {
    setThreads((map) => ({ ...map, [typeId]: next }));
  }

  async function send(e, preset) {
    e?.preventDefault();
    const text = String(preset || draft).trim();
    if (!text || busy) return;
    const probeType = typeId;
    const history = [...(threads[probeType] || []), { role: 'user', content: text }];
    setThreads((map) => ({ ...map, [probeType]: history }));
    setDraft('');
    setErr('');
    setBusy(true);
    try {
      const out = await runPersonaProbe({ typeId: probeType, message: text, conversationId: conversations[probeType] });
      if (out.conversationId) setConversations((map) => ({ ...map, [probeType]: out.conversationId }));
      setThreads((map) => ({
        ...map,
        [probeType]: [
          ...(map[probeType] || history),
          {
            role: 'assistant',
            content: out.text,
            model: out.model,
          },
        ],
      }));
    } catch (ex) {
      const msg = ex.message || String(ex);
      setErr(msg);
      setThreads((map) => ({
        ...map,
        [probeType]: [...(map[probeType] || history), { role: 'assistant', content: msg, error: true }],
      }));
    } finally {
      setBusy(false);
    }
  }

  const probes = PROBES[typeId] || PROBES.analyst;

  return (
    <section className="adm-mini-chat">
      <header className="adm-mini-head">
        <div>
          <b>Persona probe</b>
          <span>
            Testing the shipped {meta.label} prompt · admin only
          </span>
        </div>
        <button
          type="button"
          className="adm-btn ghost tiny"
          disabled={!messages.length && !err}
          onClick={() => {
            setThread([]);
            setConversations((map) => ({ ...map, [typeId]: null }));
            setErr('');
          }}
        >
          Clear
        </button>
      </header>

      <div ref={scroller} className="adm-mini-log">
        {!messages.length && !busy ? (
          <p className="adm-mini-empty">
            Answers use the shipped {meta.label} prompt (<code>src/data/personas/</code>) through
            research-chat, which honours the probe for platform admins only. Each probe is saved as a
            conversation in your account.
          </p>
        ) : null}
        {messages.map((m, i) => (
          <article key={`${typeId}-${i}`} className={`adm-mini-msg ${m.role}${m.error ? ' err' : ''}`}>
            <span>{m.role === 'user' ? 'You' : m.model || 'Niyantran'}</span>
            {m.role === 'assistant' && !m.error ? <AiMarkdown text={m.content} /> : <p>{m.content}</p>}
          </article>
        ))}
        {busy ? (
          <article className="adm-mini-msg assistant">
            <span>Niyantran</span>
            <p>Reading as {meta.short}…</p>
          </article>
        ) : null}
      </div>

      {err ? <p className="adm-msg err">{err}</p> : null}

      {!messages.length ? (
        <div className="adm-mini-probes">
          {probes.map((q) => (
            <button key={q} type="button" disabled={busy} onClick={(e) => send(e, q)}>
              {q}
            </button>
          ))}
        </div>
      ) : null}

      <form className="adm-mini-form" onSubmit={send}>
        <textarea
          ref={box}
          rows={2}
          value={draft}
          disabled={busy}
          placeholder={`Ask as ${meta.short}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="adm-mini-row">
          <button className="adm-btn" type="submit" disabled={busy || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
