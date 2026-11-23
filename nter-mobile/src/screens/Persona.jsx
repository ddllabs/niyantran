// Screen 02: Persona Selection.
// The product asks what kind of work the user does, then adapts its prompts and outputs.
import { useState } from 'react';
import { useApp } from '../state/app.jsx';
import { PERSONAS } from '../data/personas.js';
import Icon from '../ui/Icon.jsx';
import { asset } from '../lib/asset.js';

export default function PersonaScreen() {
  const { choosePersona, personaDb, signedIn, signOut, setStage } = useApp();
  const [pick, setPick] = useState(
    PERSONAS.find((p) => p.db === personaDb) || PERSONAS.find((p) => p.id === 'lawyer') || PERSONAS[0]
  );
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    await choosePersona(pick);
    setBusy(false);
  };

  return (
    <div className="view persona-selection-view">
      <div className="persona-hdr">
        <button
          type="button"
          className="ib"
          onClick={() => (signedIn ? signOut() : setStage('welcome'))}
          aria-label="Back to welcome"
        >
          <Icon name="back" />
        </button>
        <div className="brand-center">
          <img src={asset('/brand/logo-128.webp')} alt="" className="pi-logo" />
          <span className="brand-text">TERMINAL</span>
        </div>
        <div className="hdr-spacer" />
      </div>

      <div className="body persona-body">
        <div className="stepper-k">PERSONALISE YOUR TERMINAL · 1 OF 3</div>
        <h1 className="persona-title">What kind of work do you do?</h1>
        <p className="persona-sub">We'll tune the feed, prompts and quick documents around your daily work.</p>

        <div className="persona-grid-2col">
          {PERSONAS.map((p) => {
            const isSelected = pick.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`persona-card-sb ${isSelected ? 'selected' : ''}`}
                onClick={() => setPick(p)}
                aria-pressed={isSelected}
              >
                <div className="card-top">
                  <div className="badge-initials">{p.badge || p.shortLabel?.slice(0, 2)}</div>
                  {isSelected && (
                    <div className="check-badge">
                      <Icon name="check" />
                    </div>
                  )}
                </div>
                <div className="card-info">
                  <div className="p-name">{p.shortLabel || p.name}</div>
                  <div className="p-sub">{p.subLabel || p.tag}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="persona-foot">
          <button
            type="button"
            className="pbtn continue-persona-btn"
            disabled={busy}
            onClick={go}
          >
            {busy ? 'Setting up…' : `Continue as ${pick.shortLabel || pick.name} →`}
          </button>
        </div>
      </div>
    </div>
  );
}
