import { useCallback, useEffect, useState } from 'react';
import { accessToken, functionsUrl } from '../lib/supabaseClient.js';
import { notifyRegistryChanged } from '../lib/aiRegistry.js';
import { catalogueChoices, formatEfforts, modelDraftToRow, parseEfforts, pricingLabel, rolesForDisplay } from './allowlistEditor.js';

/**
 * The allowlist editor (foundation spec §D.1): the admin "AI models" page
 * when VITE_AI_BACKEND=supabase. Reads and writes only through the
 * admin-models edge function; a non-admin sees the list read-only with the
 * server's message. A model id is chosen from the OpenRouter catalogue or
 * not at all.
 */

async function adminFetch(method, body) {
  const token = await accessToken();
  if (!token) {
    const err = new Error('Sign in with an admin account to edit the allowlist.');
    err.status = 401;
    throw err;
  }
  const res = await fetch(functionsUrl('admin-models'), {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export function AllowlistEditor() {
  const [data, setData] = useState({ models: [], roles: [], catalogue: [] });
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [banner, setBanner] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState('');
  const [addId, setAddId] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await adminFetch('GET');
      setData(next);
      setDrafts({});
      setReadOnly(false);
      setBanner('');
    } catch (e) {
      setReadOnly(true);
      setBanner(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function save(kind, row, key) {
    setBusy(key);
    setErrors((prev) => ({ ...prev, [key]: '' }));
    try {
      await adminFetch('PUT', { kind, row });
      await reload();
      notifyRegistryChanged();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [key]: e.message }));
    } finally {
      setBusy('');
    }
  }

  const draftOf = (m) => drafts[m.model_id] || { ...m, efforts: formatEfforts(m.efforts) };
  const patchDraft = (id, field, value) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || draftOf(data.models.find((m) => m.model_id === id) || { model_id: id })), [field]: value } }));

  const pricingById = Object.fromEntries((data.catalogue || []).map((c) => [c.model_id, c]));
  const choices = catalogueChoices(data.catalogue, data.models);
  const enabledModels = (data.models || []).filter((m) => m.enabled);
  const roles = rolesForDisplay(data.roles);

  return (
    <>
      <h1 className="adm-h1">AI models</h1>
      <p className="adm-lede">
        The allowlist of models Ask AI may call. Only models present in the OpenRouter catalogue with tool calling can be
        enabled; the catalogue refreshes every twelve hours. The server refuses any model not enabled here. Roles pick
        which enabled model answers each kind of question.
      </p>
      {banner ? (
        <p className="adm-msg" role="alert">
          {banner}
        </p>
      ) : null}
      {loading ? <p className="adm-lede">Loading…</p> : null}

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Label</th>
              <th>Tier</th>
              <th>Efforts</th>
              <th>Order</th>
              <th>Enabled</th>
              <th>Default</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data.models || []).map((m) => {
              const d = draftOf(m);
              const key = `model:${m.model_id}`;
              return (
                <tr key={m.model_id}>
                  <td>
                    <span className="feat">{m.model_id}</span>
                    <div className="note">{m.vendor} · {pricingLabel(pricingById[m.model_id]) || 'not in current catalogue'}</div>
                  </td>
                  <td>
                    <input value={d.label} disabled={readOnly} onChange={(e) => patchDraft(m.model_id, 'label', e.target.value)} />
                  </td>
                  <td>
                    <select value={String(d.tier)} disabled={readOnly} onChange={(e) => patchDraft(m.model_id, 'tier', Number(e.target.value))}>
                      <option value="1">1 · cheap</option>
                      <option value="2">2</option>
                      <option value="3">3 · costly</option>
                    </select>
                  </td>
                  <td>
                    <input value={d.efforts} disabled={readOnly} placeholder="low, medium, high" onChange={(e) => patchDraft(m.model_id, 'efforts', e.target.value)} />
                  </td>
                  <td>
                    <input type="number" value={d.sort_order} disabled={readOnly} style={{ width: 64 }} onChange={(e) => patchDraft(m.model_id, 'sort_order', e.target.value)} />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(m.enabled)}
                      disabled={readOnly || busy === key}
                      onChange={(e) => save('model', { model_id: m.model_id, enabled: e.target.checked }, key)}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="default-model"
                      checked={Boolean(m.is_default)}
                      disabled={readOnly || !m.enabled || busy === key}
                      onChange={() => save('model', { model_id: m.model_id, is_default: true }, key)}
                    />
                  </td>
                  <td>
                    <button
                      className="adm-btn"
                      type="button"
                      disabled={readOnly || busy === key}
                      onClick={() => save('model', { ...modelDraftToRow({ ...d, efforts: parseEfforts(d.efforts) }), enabled: m.enabled, is_default: m.is_default }, key)}
                    >
                      Save
                    </button>
                    {errors[key] ? (
                      <div className="note" role="alert" style={{ color: 'var(--adm-red)' }}>
                        {errors[key]}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!loading && !(data.models || []).length ? (
              <tr>
                <td colSpan={8} className="note">
                  No models on the allowlist yet. Add one from the catalogue below.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="adm-actions">
        <select value={addId} disabled={readOnly} onChange={(e) => setAddId(e.target.value)}>
          <option value="">Add from catalogue… ({choices.length} tool-capable models)</option>
          {choices.map((c) => (
            <option key={c.model_id} value={c.model_id}>
              {c.model_id} — {pricingLabel(c) || 'price unknown'}
            </option>
          ))}
        </select>
        <button
          className="adm-btn"
          type="button"
          disabled={readOnly || !addId || busy === 'add'}
          onClick={() => {
            const id = addId;
            setAddId('');
            save('model', { model_id: id, label: id.split('/').pop(), enabled: false }, 'add');
          }}
        >
          Add (disabled)
        </button>
        {errors.add ? (
          <span className="adm-msg" role="alert">
            {errors.add}
          </span>
        ) : null}
      </div>

      <h2 className="adm-h1" style={{ marginTop: 24 }}>
        Roles
      </h2>
      <p className="adm-lede">Each role routes to one enabled model. Ask AI picks the role from the question and its attachments.</p>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>When to use</th>
              <th>Model</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const key = `role:${r.role_id}`;
              return (
                <tr key={r.role_id}>
                  <td>
                    <span className="feat">{r.label}</span>
                    <div className="note">{r.role_id}</div>
                  </td>
                  <td className="note">{r.hint}</td>
                  <td>
                    <select
                      value={r.model_id || ''}
                      disabled={readOnly || busy === key}
                      onChange={(e) => save('role', { role_id: r.role_id, label: r.label, hint: r.hint, sort_order: r.sort_order, model_id: e.target.value }, key)}
                    >
                      <option value="">— choose an enabled model —</option>
                      {enabledModels.map((m) => (
                        <option key={m.model_id} value={m.model_id}>
                          {m.label} ({m.model_id})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {errors[key] ? (
                      <div className="note" role="alert" style={{ color: 'var(--adm-red)' }}>
                        {errors[key]}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
