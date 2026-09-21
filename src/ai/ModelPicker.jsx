/**
 * The model row, fed by the database allowlist (streaming spec §G). The
 * server re-resolves whatever is chosen here, so this is a convenience, not a
 * control: a model that is not an enabled row cannot be reached by picking it.
 * Reasoning efforts are limited to the ones the chosen model accepts, because
 * the vocabulary differs by model.
 */
import './research.css';
import { AiBrandIcon } from './AiBrandIcon.jsx';

function allowedModels(models) {
  return (Array.isArray(models) ? models : []).filter(m => m && typeof m.model_id === 'string' && m.model_id.trim() && m.enabled !== false && m.allowed !== false);
}

const EFFORT_LABELS = { off: 'No reasoning', low: 'Low', medium: 'Medium', high: 'High' };

export function groupByVendor(models) {
  const groups = new Map();
  for (const m of allowedModels(models)) {
    const vendor = m.vendor || String(m.model_id || '').split('/')[0] || 'other';
    if (!groups.has(vendor)) groups.set(vendor, []);
    groups.get(vendor).push(m);
  }
  return [...groups.entries()].map(([vendor, items]) => ({ vendor, items }));
}

/** A one-to-three dot cost hint from the model's tier. */
export function costHint(model) {
  const tier = Number(model?.tier) || 1;
  return '•'.repeat(Math.min(3, Math.max(1, tier)));
}

export function effortsFor(models, modelId) {
  const model = allowedModels(models).find((m) => m.model_id === modelId);
  if (!model) return [];
  return [...new Set(['off', ...(Array.isArray(model.efforts) ? model.efforts : []).filter(e => Object.hasOwn(EFFORT_LABELS, e))])];
}

export default function ModelPicker({ models = [], roles = [], value, onChange, open, onToggle }) {
  models = allowedModels(models);
  const groups = groupByVendor(models);
  const picked = models.find((m) => m.model_id === value?.modelId) || models.find((m) => m.is_default) || models[0] || null;

  const efforts = effortsFor(models, picked?.model_id);
  const select = modelId => {
    if (!models.some(m => m.model_id === modelId)) return;
    onChange?.({ ...value, modelId, effort: effortsFor(models, modelId).includes(value?.effort) ? value.effort : 'off' });
  };

  return (
    <div className="ai-v2-model ai-research-model" onKeyDown={e => { if (open && e.key === 'Escape') { e.stopPropagation(); onToggle?.(); e.currentTarget.querySelector('button')?.focus(); } }}>
      <button type="button" className={`ai-v2-model-btn${open ? ' open' : ''}`} aria-expanded={open} aria-label="Choose model" onClick={onToggle}>
        <AiBrandIcon id={picked?.vendor || 'openrouter'} size={16} />
        <span>{picked?.label || 'Model'}</span>
        <span className="ai-v2-model-cost" aria-hidden="true">{picked ? costHint(picked) : ''}</span>
      </button>

      {open ? (
        <div className="ai-v2-model-menu" role="group" aria-label="Model settings">
          {roles.length ? (
            <>
              <p className="ai-v2-model-sec">Roles</p>
              <div className="ai-v2-roles">
                {roles.map((r) => (
                  <button
                    key={r.role_id}
                    type="button"
                    className={`ai-v2-role${r.model_id === picked?.model_id ? ' on' : ''}`}
                    title={r.hint}
                    aria-pressed={r.model_id === picked?.model_id}
                    disabled={r.enabled === false || !models.some(m => m.model_id === r.model_id)}
                    onClick={() => { if (r.enabled !== false) select(r.model_id); }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {groups.map((g) => (
            <div key={g.vendor}>
              <p className="ai-v2-model-sec">{g.vendor}</p>
              {g.items.map((m) => (
                <button
                  key={m.model_id}
                  type="button"
                  aria-pressed={m.model_id === picked?.model_id}
                  className={`ai-v2-model-opt${m.model_id === picked?.model_id ? ' on' : ''}`}
                  onClick={() => select(m.model_id)}
                >
                  <AiBrandIcon id={m.vendor} size={16} />
                  <span className="ai-v2-model-copy">
                    <em>{m.label}</em>
                    <small>{m.is_default ? 'Default' : ''}</small>
                  </span>
                  <span className="ai-v2-model-cost" aria-hidden="true">{costHint(m)}</span>
                </button>
              ))}
            </div>
          ))}

          <p className="ai-v2-model-sec">Reasoning</p>
          <div className="ai-v2-efforts">
            {efforts.map((e) => (
              <button
                key={e}
                type="button"
                className={`ai-v2-effort${(efforts.includes(value?.effort) ? value.effort : 'off') === e ? ' on' : ''}`}
                aria-pressed={(efforts.includes(value?.effort) ? value.effort : 'off') === e}
                onClick={() => onChange?.({ ...value, modelId: picked.model_id, effort: e })}
              >
                {EFFORT_LABELS[e] || e}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
