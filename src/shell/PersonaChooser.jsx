import { useMemo, useState } from 'react';
import {
  PERSONAS,
  PERSONA_FOLLOWUPS,
  writePersonaAnswers,
  writePersonaId,
} from '../lib/personas.js';
import { persistPersona, setSessionUser, sessionUser, userTypeOf } from '../lib/userStore.js';
import { trackProductEvent } from '../lib/productAnalytics.js';
import { supabase } from '../lib/supabaseClient.js';

/** Map marketing persona ids onto USER_TYPES desk allowlists. */
function userTypeForPersona(id) {
  return userTypeOf(id).id;
}

const PERSONA_RPC_MAP = {
  policy: 'policy_analyst',
  journalist: 'journalist',
  student: 'upsc_aspirant',
  analyst: 'corporate_affairs',
  lawyer: 'legal_researcher',
  researcher: 'academic',
  academic: 'academic',
};

const JURISDICTIONS = {
  lawyer: [
    { id: 'sci', label: 'Supreme Court of India' },
    { id: 'dhc', label: 'High Court of Delhi' },
    { id: 'bhc', label: 'High Court of Bombay' },
    { id: 'nclat', label: 'National Company Law Appellate Tribunal (NCLAT)' },
    { id: 'khc', label: 'High Court of Karnataka' },
  ],
  policy: [
    { id: 'central_ministries', label: 'Central Ministries & Cabinet Secretariat' },
    { id: 'parliament_committees', label: 'Parliamentary Standing Committees' },
    { id: 'think_tanks', label: 'Public Policy Institutes & Think Tanks' },
    { id: 'state_govts', label: 'State Governments & Departments' },
  ],
  student: [
    { id: 'upsc', label: 'UPSC Civil Services Examination (CSE)' },
    { id: 'state_psc', label: 'State Public Service Commission (State PSC)' },
    { id: 'judiciary', label: 'Judicial Services Examination' },
  ],
  journalist: [
    { id: 'parliament', label: 'Parliament of India & Ministries' },
    { id: 'sci_courts', label: 'Supreme Court & High Courts' },
    { id: 'finance_rbi', label: 'Ministry of Finance & Reserve Bank of India' },
    { id: 'ec_eci', label: 'Election Commission of India' },
  ],
  analyst: [
    { id: 'fin_sebi', label: 'SEBI & Indian Capital Markets' },
    { id: 'niti_central', label: 'NITI Aayog & Central Planning' },
    { id: 'infra_energy', label: 'Infrastructure & Power Ministries' },
  ],
  researcher: [
    { id: 'national_archives', label: 'National Legal & Legislative Archives' },
    { id: 'nlu_academia', label: 'National Law Universities & Research Institutes' },
    { id: 'gazettes', label: 'The Gazette of India & State Gazettes' },
  ],
};
JURISDICTIONS.academic = JURISDICTIONS.researcher;

const PRACTICE_AREAS = {
  lawyer: [
    { id: 'commercial', label: 'Commercial Litigation & Arbitration' },
    { id: 'constitutional', label: 'Constitutional & Administrative Law' },
    { id: 'regulatory', label: 'Regulatory, Competition & SEBI Compliance' },
    { id: 'criminal', label: 'Criminal Law & Special Statutes' },
    { id: 'ipr', label: 'Intellectual Property Rights' },
  ],
  policy: [
    { id: 'governance_reforms', label: 'Governance Reforms & Institutional Design' },
    { id: 'regulatory_impact', label: 'Regulatory Impact Assessment & Policy Drafting' },
    { id: 'budget_fiscal', label: 'Budgetary & Fiscal Policy Analysis' },
  ],
  student: [
    { id: 'gs2', label: 'GS Paper II: Polity, Constitution & Governance' },
    { id: 'gs3', label: 'GS Paper III: Economy, Environment & Security' },
    { id: 'law_optional', label: 'Law Optional / Public Administration' },
    { id: 'psir_optional', label: 'Political Science & International Relations (PSIR)' },
  ],
  journalist: [
    { id: 'investigative', label: 'Investigative & Document-backed Reporting' },
    { id: 'legal_court', label: 'Legal & Judicial Proceedings' },
    { id: 'policy_econ', label: 'Public Policy, Cabinet & Macroeconomics' },
  ],
  analyst: [
    { id: 'macro', label: 'Macroeconomic & Fiscal Policy Analysis' },
    { id: 'energy_transition', label: 'Energy Transition & Industrial Policy' },
    { id: 'tech_telecom', label: 'Technology, Data Governance & Telecom' },
  ],
  researcher: [
    { id: 'statutory_evolution', label: 'Statutory Interpretation & Legislative History' },
    { id: 'comparative_law', label: 'Comparative Constitutionalism' },
    { id: 'socio_legal', label: 'Socio-Legal Empirical Research' },
  ],
};
PRACTICE_AREAS.academic = PRACTICE_AREAS.researcher;

export default function PersonaChooser({ onDone, onCancel }) {
  const [step, setStep] = useState(1); // 1: Persona, 2: Jurisdiction, 3: Practice Area
  const [picked, setPicked] = useState(null);
  const [answers, setAnswers] = useState({});
  const followups = useMemo(() => PERSONA_FOLLOWUPS.slice(0, 2), []);

  const personaKey = picked?.id || 'lawyer';
  const availableJurisdictions = JURISDICTIONS[personaKey] || JURISDICTIONS.lawyer;
  const availablePracticeAreas = PRACTICE_AREAS[personaKey] || PRACTICE_AREAS.lawyer;

  async function finish() {
    if (!picked) return;
    writePersonaId(picked.id);
    writePersonaAnswers(answers);
    const user = sessionUser();
    if (user) {
      const type = userTypeForPersona(picked.id);
      setSessionUser({ ...user, type, personaId: picked.id, personaSaved: true });
      const land =
        answers.start === 'home' ? 'home' : userTypeOf(type).startTab || 'home';
      sessionStorage.setItem('niyantranLand', land);

      persistPersona(type).then((saved) => {
        trackProductEvent('persona_persisted', { personaId: picked.id, saved });
      });

      // Call database RPC to update onboarding profile
      try {
        const rpcPersona = PERSONA_RPC_MAP[picked.id] || 'legal_researcher';
        await supabase.rpc('update_my_onboarding_profile', {
          p_persona: rpcPersona,
          p_practice_area: answers.practice_area || null,
          p_jurisdiction: answers.jurisdiction || null,
          p_language: 'en',
          p_onboarding_complete: true,
        });
      } catch {
        // Non-blocking: continue if RPC call fails or user unauthenticated
      }
    }
    trackProductEvent('persona_selected', { personaId: picked.id, answers });
    onDone?.(picked);
  }

  return (
    <div className="persona-chooser" role="dialog" aria-labelledby="persona-chooser-title">
      <div className="persona-chooser-card">
        {/* Step progress pills */}
        <div className="persona-step-indicator" role="navigation" aria-label="Onboarding Steps">
          <span className={`step-badge ${step >= 1 ? 'active' : ''}`}>1. Persona</span>
          <span className="step-arrow">→</span>
          <span className={`step-badge ${step >= 2 ? 'active' : ''}`}>2. Jurisdiction</span>
          <span className="step-arrow">→</span>
          <span className={`step-badge ${step >= 3 ? 'active' : ''}`}>3. Practice Area</span>
        </div>

        <p className="persona-kicker">Saved to your account · change it any time from your profile</p>

        {/* STEP 1: Persona Selection */}
        {step === 1 && (
          <>
            <h1 id="persona-chooser-title">Who are you working as?</h1>
            <p className="persona-lead">
              Choose a persona so the terminal opens on the desks that matter.
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
            <div className="persona-wizard-actions">
              {onCancel ? (
                <button type="button" className="persona-cancel" onClick={onCancel}>
                  Keep my current persona
                </button>
              ) : <div />}
              <button
                type="button"
                className="persona-continue"
                disabled={!picked}
                onClick={() => setStep(2)}
              >
                Next: Jurisdiction & Focus →
              </button>
            </div>
          </>
        )}

        {/* STEP 2: Jurisdiction & Institutions */}
        {step === 2 && (
          <>
            <h1 id="persona-chooser-title">Primary Jurisdiction & Institutions</h1>
            <p className="persona-lead">
              Select your primary working jurisdiction or court to configure citation grounding.
            </p>
            <div className="persona-selection-list">
              {availableJurisdictions.map((j) => (
                <label key={j.id} className={`persona-radio-option ${answers.jurisdiction === j.label ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="jurisdiction"
                    value={j.label}
                    checked={answers.jurisdiction === j.label}
                    onChange={() => setAnswers((a) => ({ ...a, jurisdiction: j.label }))}
                  />
                  <span>{j.label}</span>
                </label>
              ))}
            </div>
            <div className="persona-wizard-actions">
              <button type="button" className="persona-cancel" onClick={() => setStep(1)}>
                ← Back to Personas
              </button>
              <button
                type="button"
                className="persona-continue"
                onClick={() => setStep(3)}
              >
                Next: Practice Area →
              </button>
            </div>
          </>
        )}

        {/* STEP 3: Practice Area & Final Preferences */}
        {step === 3 && (
          <>
            <h1 id="persona-chooser-title">Core Practice Area & Preferences</h1>
            <p className="persona-lead">
              Configure your primary research focus and landing desk.
            </p>
            <div className="persona-selection-list">
              {availablePracticeAreas.map((pa) => (
                <label key={pa.id} className={`persona-radio-option ${answers.practice_area === pa.label ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="practice_area"
                    value={pa.label}
                    checked={answers.practice_area === pa.label}
                    onChange={() => setAnswers((a) => ({ ...a, practice_area: pa.label }))}
                  />
                  <span>{pa.label}</span>
                </label>
              ))}
            </div>

            <div className="persona-followups">
              {followups.map((f) => (
                <label key={f.id}>
                  <span>{f.q}</span>
                  <select
                    value={answers[f.id] || ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                  >
                    <option value="">Default</option>
                    {f.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="persona-wizard-actions">
              <button type="button" className="persona-cancel" onClick={() => setStep(2)}>
                ← Back
              </button>
              <button type="button" className="persona-continue" onClick={finish}>
                Complete & Enter Terminal →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
