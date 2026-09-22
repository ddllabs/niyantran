import { useMemo, useState } from 'react';
import {
  PERSONAS,
  PERSONA_FOLLOWUPS,
  writePersonaAnswers,
  writePersonaId,
} from '../lib/personas.js';
import { persistPersona, setSessionUser, sessionUser, userTypeOf } from '../lib/userStore.js';
import { trackProductEvent } from '../lib/productAnalytics.js';

/** Map marketing persona ids onto USER_TYPES desk allowlists. */
function userTypeForPersona(id) {
  return userTypeOf(id).id;
}

export default function PersonaChooser({ onDone }) {
  const [picked, setPicked] = useState(null);
  const [answers, setAnswers] = useState({});
  const followups = useMemo(() => PERSONA_FOLLOWUPS.slice(0, 2), []);

  function finish() {
    if (!picked) return;
    writePersonaId(picked.id);
    writePersonaAnswers(answers);
    const user = sessionUser();
    if (user) {
      const type = userTypeForPersona(picked.id);
      setSessionUser({ ...user, type, personaId: picked.id });
      const land =
        answers.start === 'home' ? 'home' : userTypeOf(type).startTab || 'home';
      sessionStorage.setItem('niyantranLand', land);
      // The desk chat reads the persona from the profile, not from this
      // device, so the choice has to outlive the session to reach the prompt.
      // Not awaited: landing on the chosen desk should not wait on a write,
      // and a signed-out chooser has nowhere to write to. Reported either way,
      // because a silent failure here answers every later turn as an analyst.
      persistPersona(type).then((saved) => {
        trackProductEvent('persona_persisted', { personaId: picked.id, saved });
      });
    }
    trackProductEvent('persona_selected', { personaId: picked.id, answers });
    onDone?.(picked);
  }

  return (
    <div className="persona-chooser" role="dialog" aria-labelledby="persona-chooser-title">
      <div className="persona-chooser-card">
        <p className="persona-kicker">Provisional · saved on this device until accounts</p>
        <h1 id="persona-chooser-title">Who are you working as?</h1>
        <p className="persona-lead">
          Choose a persona so the terminal opens on the desks that matter. Hover a card to see what you get.
        </p>
        <div className="persona-grid">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`persona-card tone-${p.tone}${picked?.id === p.id ? ' on' : ''}`}
              onClick={() => setPicked(p)}
            >
              <strong>{p.label}</strong>
              <span className="persona-blurb">{p.blurb}</span>
              <ul className="persona-gets">
                {p.gets.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        {picked ? (
          <div className="persona-followups">
            {followups.map((f) => (
              <label key={f.id}>
                <span>{f.q}</span>
                <select
                  value={answers[f.id] || ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                >
                  <option value="">Skip</option>
                  {f.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button type="button" className="persona-continue" onClick={finish}>
              Continue to terminal
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
