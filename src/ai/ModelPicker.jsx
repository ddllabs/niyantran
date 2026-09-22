/**
 * The model row, fed by the database allowlist (streaming spec §G). The
 * server re-resolves whatever is chosen here, so this is a convenience, not a
 * control: a model that is not an enabled row cannot be reached by picking it.
 * Reasoning efforts are limited to the ones the chosen model accepts, because
 * the vocabulary differs by model - and it differs a lot: of the seven enabled
 * rows, DeepSeek accepts only high and xhigh, Gemini 3.5 Lite starts at minimal
 * and cannot be turned off, and Claude reaches max.
 *
 * So the rungs belong under the model, behind a disclosure, rather than in one
 * row at the foot of the menu. A single row could only ever describe whichever
 * model happened to be picked, and it re-normalised silently when the pick
 * changed: "I set it to high" quietly became something else with nothing on
 * screen to say so. The accordion is optional depth - clicking a model row
 * still selects it at its own default and closes nothing.
 *
 * The open row is owned by the caller, like `open` for the menu itself, so this
 * stays a plain function of its props.
 */
import './research.css';
import { AiBrandIcon } from './AiBrandIcon.jsx';

function allowedModels(models) {
  return (Array.isArray(models) ? models : []).filter(m => m && typeof m.model_id === 'string' && m.model_id.trim() && m.enabled !== false && m.allowed !== false);
}

/**
 * OpenRouter's reasoning vocabulary, cheapest first. The list used to stop at
 * high, so `max` and `xhigh` - which claude-sonnet-5 and gpt-6-astra both
 * accept - were unreachable, and a rung typed into the admin editor was saved
 * to the database and then silently dropped here.
 *
 * `off` is this codebase's sentinel for "send no reasoning block"; OpenRouter's
 * equivalent rung is `none`, and refresh-model-pricing folds one onto the other
 * so the picker only ever has one way to say it. Same order as
 * public.effort_rank - both are the cheapest-first ladder.
 */
const EFFORT_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_LABELS = {
  off: 'No reasoning',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

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

/**
 * The rungs this model accepts, cheapest first.
 *
 * `off` is no longer prepended unconditionally. It is in the stored list when
 * the model allows reasoning to be turned off, and absent when OpenRouter
 * reports `mandatory` - gpt-6-astra and both Gemini 3.x rows mandate it, and
 * offering "No reasoning" there was offering something the model would refuse.
 * refresh-model-pricing keeps the list in step with the catalogue.
 */
export function effortsFor(models, modelId) {
  const model = allowedModels(models).find((m) => m.model_id === modelId);
  if (!model) return [];
  const stored = new Set((Array.isArray(model.efforts) ? model.efforts : []).filter(e => Object.hasOwn(EFFORT_LABELS, e)));
  return EFFORT_ORDER.filter(e => stored.has(e));
}

/**
 * What a reader who has never opened this menu gets: reasoning on, at the
 * cheapest setting the model offers. The previous fallback was 'off', so every
 * turn ran with reasoning_tokens 0 unless someone went looking for the control
 * - and the research loop is exactly the work that wants the model to plan
 * between searches. 'off' stays available; it is now a choice rather than the
 * consequence of not making one.
 */
export function defaultEffortFor(models, modelId) {
  const efforts = effortsFor(models, modelId);
  // The cheapest rung that is not 'off', because the ladder is no longer the
  // same for every model: DeepSeek starts at 'high' and gemini-3.5-flash-lite
  // at 'minimal', so asking for 'low' by name would pick nothing on one and
  // skip a cheaper rung on the other.
  return efforts.find(e => e !== 'off') || efforts[0] || 'off';
}

export default function ModelPicker({ models = [], roles = [], value, onChange, open, onToggle, effortsOpenFor = '', onToggleEfforts }) {
  models = allowedModels(models);
  const groups = groupByVendor(models);
  const picked = models.find((m) => m.model_id === value?.modelId) || models.find((m) => m.is_default) || models[0] || null;

  const efforts = effortsFor(models, picked?.model_id);
  const chosen = efforts.includes(value?.effort) ? value.effort : defaultEffortFor(models, picked?.model_id);
  const select = modelId => {
    if (!models.some(m => m.model_id === modelId)) return;
    onChange?.({ ...value, modelId, effort: effortsFor(models, modelId).includes(value?.effort) ? value.effort : defaultEffortFor(models, modelId) });
  };

  return (
    <div className="ai-v2-model ai-research-model" onKeyDown={e => { if (open && e.key === 'Escape') { e.stopPropagation(); onToggle?.(); e.currentTarget.querySelector('button')?.focus(); } }}>
      <button
        type="button"
        className={`ai-v2-model-btn${open ? ' open' : ''}`}
        aria-expanded={open}
        aria-label={picked ? `Model: ${picked.label}, reasoning ${EFFORT_LABELS[chosen] || chosen}. Choose another.` : 'Choose model'}
        onClick={onToggle}
      >
        <AiBrandIcon id={picked?.vendor || 'openrouter'} size={16} />
        {/* The rung rides on the label, so the setting in force is readable
            without opening anything. It is a real difference in what the turn
            will do and cost, and it lived two clicks deep. */}
        <span className="ai-v2-model-name">{picked?.label || 'Model'}</span>
        {picked && chosen && chosen !== 'off' ? (
          <span className="ai-v2-model-eff">{EFFORT_LABELS[chosen] || chosen}</span>
        ) : null}
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
              {g.items.map((m) => {
                const rungs = effortsFor(models, m.model_id);
                const isPicked = m.model_id === picked?.model_id;
                const showing = effortsOpenFor === m.model_id;
                return (
                  <div key={m.model_id} className={`ai-v2-model-entry${showing ? ' open' : ''}`}>
                    <button
                      type="button"
                      aria-pressed={isPicked}
                      className={`ai-v2-model-opt${isPicked ? ' on' : ''}`}
                      onClick={() => select(m.model_id)}
                    >
                      <AiBrandIcon id={m.vendor} size={16} />
                      <span className="ai-v2-model-copy">
                        <em>{m.label}</em>
                        {/* On the picked row, the rung in force - otherwise the
                            only way to read the current setting was to open the
                            accordion. */}
                        <small>{isPicked ? EFFORT_LABELS[chosen] || chosen : m.is_default ? 'Default' : ''}</small>
                      </span>
                      <span className="ai-v2-model-cost" aria-hidden="true">{costHint(m)}</span>
                    </button>
                    {/* A separate button, not a child of the row: inside it, a
                        click on the chevron also selects the model and closes
                        the menu, which is never what reaching for it meant. */}
                    {rungs.length > 1 ? (
                      <button
                        type="button"
                        className="ai-v2-model-disclose"
                        aria-expanded={showing}
                        aria-label={showing ? `Hide reasoning levels for ${m.label}` : `Choose a reasoning level for ${m.label}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleEfforts?.(showing ? '' : m.model_id);
                        }}
                      >
                        <span aria-hidden="true">{showing ? '▾' : '▸'}</span>
                      </button>
                    ) : null}
                    {showing ? (
                      <div className="ai-v2-efforts" role="group" aria-label={`Reasoning for ${m.label}`}>
                        {rungs.map((e) => {
                          const active = isPicked && e === chosen;
                          return (
                            <button
                              key={e}
                              type="button"
                              className={`ai-v2-effort${active ? ' on' : ''}`}
                              aria-pressed={active}
                              onClick={() => onChange?.({ ...value, modelId: m.model_id, effort: e })}
                            >
                              {EFFORT_LABELS[e] || e}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
