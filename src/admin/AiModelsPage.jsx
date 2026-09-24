import { useState } from 'react';
import { loadAiModels, resetAiModels, saveAiModels } from '../lib/aiModelsStore.js';
import { aiBackend } from '../lib/aiBackend.js';
import { AllowlistEditor } from './AllowlistEditor.jsx';

/** Foundation spec §D.1: with the backend flag on, this page edits the database allowlist. */
export function AiModelsPage() {
  if (aiBackend() === 'supabase') return <AllowlistEditor />;
  return <LegacyAiModelsPage />;
}

function LegacyAiModelsPage() {
  const [roles, setRoles] = useState(() => loadAiModels());
  const [msg, setMsg] = useState('');

  function patch(id, field, value) {
    setRoles((list) =>
      list.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [field]: value };
        if (field === 'model') {
          const m = String(value).toLowerCase();
          next.provider = m.includes('gemini')
            ? 'gemini'
            : /astra|openai\/|gpt-6|openrouter/.test(m)
              ? 'openrouter'
              : 'gemini';
        }
        return next;
      }),
    );
    setMsg('');
  }

  function onSave(e) {
    e.preventDefault();
    saveAiModels(roles);
    setMsg('Model roles saved in this browser. API keys stay on the server environment.');
  }

  function onReset() {
    setRoles(resetAiModels());
    setMsg('Restored shipped defaults.');
  }

  return (
    <>
      <h1 className="adm-h1">AI models</h1>
      <p className="adm-lede">
        Research roles pick a provider + model id. Keys are read only from the host environment
        (<code>GEMINI_API_KEY</code>, <code>OPENROUTER_API_KEY</code>)
        inside <code>/api/ai/chat</code> — never from the browser. Desk training prompts live on the
        <b> AI personas</b> tab.
      </p>
      <form onSubmit={onSave}>
        <div className="adm-plans">
          {roles.map((r) => (
            <article key={r.id} className="adm-plan">
              <h3>{r.label}</h3>
              <p className="adm-plan-id">{r.id}</p>
              <div className="adm-form">
                <label className="adm-field span2">
                  <span>Display name</span>
                  <input value={r.label} onChange={(e) => patch(r.id, 'label', e.target.value)} />
                </label>
                <label className="adm-field span2">
                  <span>When to use</span>
                  <input value={r.hint} onChange={(e) => patch(r.id, 'hint', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Provider</span>
                  <select value={r.provider} onChange={(e) => patch(r.id, 'provider', e.target.value)}>
                    <option value="gemini">Gemini</option>
                    <option value="openrouter">OpenRouter</option>
                  </select>
                </label>
                <label className="adm-field">
                  <span>Model id</span>
                  <input value={r.model} onChange={(e) => patch(r.id, 'model', e.target.value)} />
                </label>
              </div>
            </article>
          ))}
        </div>
        <div className="adm-actions">
          <button className="adm-btn" type="submit">
            Save AI config
          </button>
          <button className="adm-btn ghost" type="button" onClick={onReset}>
            Restore defaults
          </button>
          {msg ? <span className="adm-msg">{msg}</span> : null}
        </div>
      </form>
    </>
  );
}
