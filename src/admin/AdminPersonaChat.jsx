import { useEffect, useRef, useState } from 'react';
import { sendAiChat } from '../lib/aiClient.js';
import { loadAiModels, pickAiRole, shortModelLabel } from '../lib/aiModelsStore.js';
import { userTypeOf } from '../lib/userTypes.js';
import AiMarkdown from '../ai/AiMarkdown.jsx';

const PROBES = {
  student: ['green hydrogen', 'Art. 21 vs Art. 19 — Prelims traps', 'Write a 15-marker on simultaneous elections'],
  journalist: ['Write the lede on the latest RBI MPC decision', 'What is still unverified in this story?', 'List the documents I should pull next'],
  lawyer: ['Legal status of simultaneous elections proposals', 'Pin the holding in Puttaswamy (2017)', 'Is an as-introduced bill law in force?'],
  policy: ['Brief the National Green Hydrogen Mission', 'Who owns PM-JANMAN and what is its funding pattern?', 'Trade-offs in a carbon border adjustment'],
  analyst: ['What would a carbon border tax touch in Indian industry?', 'Extract the load-bearing facts from this packet', 'Where is the evidence thin?'],
};

export default function AdminPersonaChat({ typeId, personaPrompt }) {
  const meta = userTypeOf(typeId);
  const [threads, setThreads] = useState({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [roleId, setRoleId] = useState('AUTO');
  const [roles] = useState(() => loadAiModels());
  const scroller = useRef(null);
  const box = useRef(null);
  const messages = threads[typeId] || [];
  const resolved = pickAiRole([], roleId);

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
      const out = await sendAiChat({
        roleId,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        attachments: [],
        userType: probeType,
        personaPrompt,
        probe: true,
      });
      setThreads((map) => ({
        ...map,
        [probeType]: [
          ...(map[probeType] || history),
          {
            role: 'assistant',
            content: out.text,
            model: out.model,
            provider: out.provider,
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
            setErr('');
          }}
        >
          Clear
        </button>
      </header>

      <div ref={scroller} className="adm-mini-log">
        {!messages.length && !busy ? (
          <p className="adm-mini-empty">
            Admin probe may override the shipped prompt for this thread. Live desk chats always use{' '}
            <code>src/data/personas/*.md</code> on the server.
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
          <select
            aria-label="Model"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            title={`${resolved.label} · ${resolved.model}`}
          >
            <option value="AUTO">auto [{resolved.provider || 'model'}]</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {shortModelLabel(r)}
              </option>
            ))}
          </select>
          <button className="adm-btn" type="submit" disabled={busy || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
