import { useEffect, useRef, useState } from 'react';
import { USER_TYPES, userTypeOf } from '../lib/userTypes.js';
import { dbPersona } from '../lib/personaMap.js';
import { DEFAULT_PERSONA_PROMPTS, loadPersonaPrompts } from '../lib/personaPromptsStore.js';
import { adminPersonas, personaEditorState } from '../lib/adminPersonas.js';
import AdminPersonaChat from './AdminPersonaChat.jsx';

export function AiPersonasPage() {
  const [data, setData] = useState(null);
  const [editors, setEditors] = useState({});
  const [typeId, setTypeId] = useState('student');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    adminPersonas(undefined, { signal: abort.signal }).then(next => {
      if (!alive.current) return;
      setData(next);
      setEditors(Object.fromEntries(USER_TYPES.map(t => [t.id, next.states.find(s => s.persona === dbPersona(t.id))?.draft_text ?? DEFAULT_PERSONA_PROMPTS[t.id]])));
    }).catch(e => { if (alive.current && !abort.signal.aborted) setError(e.message); })
      .finally(() => { if (alive.current) setBusy(false); });
    return () => { alive.current = false; abort.abort(); };
  }, []);
  const meta = userTypeOf(typeId);
  const state = data?.states.find(s => s.persona === dbPersona(typeId));
  const text = editors[typeId] ?? '';
  const bytes = new TextEncoder().encode(text).length;
  const valid = Boolean(text.trim()) && bytes <= 100_000 && !text.includes('\0');
  const dirty = Boolean(state && text !== state.draft_text);
  const history = data?.history.filter(e => e.persona === dbPersona(typeId)) ?? [];
  const status = personaEditorState(state, text);

  async function operation(action) {
    setBusy(true); setError(''); setNotice('');
    try {
      const input = action === 'reload' ? undefined : { action, persona: dbPersona(typeId), expected: state?.generation,
        ...(action === 'save' ? { text } : {}), ...(action === 'rollback' ? { revision } : {}) };
      const next = await adminPersonas(input);
      if (!alive.current) return;
      setData(next);
      if (action === 'initialize' || !data) setEditors(Object.fromEntries(USER_TYPES.map(t => [t.id, next.states.find(s => s.persona === dbPersona(t.id)).draft_text])));
      setNotice(action === 'reload' ? 'Server versions reloaded. Your editor text has been retained.' :
        action === 'save' ? 'Draft saved. Customer prompts are unchanged.' : action === 'initialize' ? 'Baseline versions initialized.' :
          'Active pilot version updated. It applies to your next new turn only.');
      setRevision('');
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setBusy(false); }
  }

  return <>
    <h1 className="adm-h1">AI personas</h1>
    <p className="adm-lede">Account-restricted pilot · Published changes affect only the designated admin account. Save a draft, test the current text, then publish when ready. Grounding and citation rules remain enforced.</p>
    {error && <p className="adm-msg" role="alert">{error}</p>}
    {!data ? <div><p>{busy ? 'Loading persona versions…' : 'The server editor is unavailable. No prompts have been changed.'}</p>{!busy && <button className="adm-btn ghost" onClick={() => operation('reload')}>Retry loading</button>}</div> : <>
      <div className="adm-persona-types" role="tablist" aria-label="Personas">
        {USER_TYPES.map((t, index) => <button key={t.id} type="button" role="tab" id={`adm-persona-tab-${t.id}`}
          aria-selected={typeId === t.id} aria-controls="adm-persona-panel" tabIndex={typeId === t.id ? 0 : -1}
          className={typeId === t.id ? 'on' : ''} disabled={busy}
          onClick={() => { setTypeId(t.id); setRevision(''); }}
          onKeyDown={e => {
            const next = e.key === 'ArrowRight' ? (index + 1) % USER_TYPES.length : e.key === 'ArrowLeft' ? (index + USER_TYPES.length - 1) % USER_TYPES.length : e.key === 'Home' ? 0 : e.key === 'End' ? USER_TYPES.length - 1 : null;
            if (next === null) return;
            e.preventDefault(); setTypeId(USER_TYPES[next].id); setRevision('');
            e.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
          }}>{t.short}</button>)}
      </div>
      {!data.states.length ? <div className="adm-card"><p>No server versions exist yet. Initialize the six verified backend defaults before editing.</p>
        <button className="adm-btn" disabled={busy} onClick={() => operation('initialize')}>Initialize baseline versions</button></div> :
      <div className="adm-persona-work" role="tabpanel" id="adm-persona-panel" aria-labelledby={`adm-persona-tab-${typeId}`}>
        <div className="adm-card">
          <p className="adm-hint" role="status">{status} · Active {state?.active_id} · revision {state?.generation}</p>
          <label className="adm-field"><span>{meta.label} · {bytes.toLocaleString()} / 100,000 bytes</span>
            <textarea className="adm-persona-body" value={text} spellCheck={false} name="persona-prompt" disabled={busy}
              onChange={e => { const value = e.target.value; setEditors(map => ({ ...map, [typeId]: value })); setNotice(''); }} />
          </label>
          <div className="adm-actions">
            <button className="adm-btn" disabled={busy || !valid || !dirty} onClick={() => operation('save')}>Save draft</button>
            <button className="adm-btn" disabled={busy || dirty || state?.draft_id === state?.active_id} onClick={() => operation('publish')}>Publish for my account</button>
            <button className="adm-btn ghost" disabled={busy} onClick={() => operation('reload')}>Reload server versions</button>
          </div>
          <details><summary>Import or restore editor text</summary><p className="adm-hint">These actions change only the editor. Save and publish are separate.</p>
            <div className="adm-actions">
              <button className="adm-btn ghost" disabled={busy} onClick={() => setEditors(map => ({ ...map, [typeId]: loadPersonaPrompts()[typeId] }))}>Import browser draft</button>
              <button className="adm-btn ghost" disabled={busy} onClick={() => setEditors(map => ({ ...map, [typeId]: state.active_text }))}>Use published text</button>
              <button className="adm-btn ghost" disabled={busy} onClick={() => setEditors(map => ({ ...map, [typeId]: DEFAULT_PERSONA_PROMPTS[typeId] }))}>Use bundled default</button>
            </div>
          </details>
          <details><summary>Version history & rollback</summary>
            <label className="adm-field"><span>Choose a previous version</span><select value={revision} disabled={busy} onChange={e => setRevision(e.target.value)}>
              <option value="">Select version…</option>{history.map(e => <option key={e.id} value={e.revision_id}>{e.action} · {new Date(e.created_at).toLocaleString()} · {e.revision_id}</option>)}
            </select></label>
            <button className="adm-btn ghost" disabled={busy || !revision} onClick={() => operation('rollback')}>Activate selected version for my account</button>
          </details>
          {notice && <p className="adm-msg" role="status">{notice}</p>}
        </div>
        <AdminPersonaChat typeId={typeId} promptText={text} disabled={busy || !valid} />
      </div>}
    </>}
  </>;
}
