import { useEffect, useRef, useState } from 'react';
import {
  DESK_TOUR_STEPS,
  HOME_TOUR_STEPS,
  markDeskTourDone,
  markHomeTourDone,
  watchTourWanted,
} from '../lib/onboarding.js';
import { trackProductEvent } from '../lib/productAnalytics.js';

/**
 * Lightweight first-run coachmarks (CR-08).
 * Home: once. Each desk: 3 steps on first entry.
 * Dismisses when the user clicks outside or starts working; Back/Next to navigate.
 */
export default function OnboardingTour({ kind, deskId }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const cardRef = useRef(null);

  useEffect(() => {
    setOpen(false);
    setI(0);
    // F200: decided once the account is bound; until then its done flags cannot be read (after a
    // page load), and a tour already done showed again.
    return watchTourWanted(kind, deskId, setOpen);
  }, [kind, deskId]);

  function finish(reason = 'done') {
    if (kind === 'home') markHomeTourDone();
    else if (deskId) markDeskTourDone(deskId);
    trackProductEvent('tour_done', { kind, deskId: deskId || null, reason, step: i });
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;

    function dismiss(reason = 'dismiss') {
      finish(reason);
    }

    function onPointerDown(e) {
      const card = cardRef.current;
      if (card && card.contains(e.target)) return;
      dismiss('outside');
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss('escape');
        return;
      }
      const steps = kind === 'home' ? HOME_TOUR_STEPS : DESK_TOUR_STEPS;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setI((n) => {
          if (n >= steps.length - 1) {
            dismiss('keyboard_done');
            return n;
          }
          return n + 1;
        });
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
    // finish closes over latest i/kind/deskId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, deskId, i]);

  if (!open) return null;

  const steps = kind === 'home' ? HOME_TOUR_STEPS : DESK_TOUR_STEPS;
  const step = steps[i] || steps[0];
  const last = i >= steps.length - 1;
  const first = i <= 0;

  return (
    <div className="niy-tour" role="dialog" aria-label="First-run tour" aria-modal="false">
      <div className="niy-tour-card" ref={cardRef}>
        <p className="niy-tour-kicker">
          {kind === 'home' ? 'Home tour' : 'Desk tour'} · {i + 1}/{steps.length}
        </p>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="niy-tour-actions">
          <button type="button" className="ghost" onClick={() => finish('skip')}>
            Skip
          </button>
          <div className="niy-tour-nav">
            <button type="button" className="ghost" disabled={first} onClick={() => setI((n) => Math.max(0, n - 1))}>
              Back
            </button>
            <button type="button" onClick={() => (last ? finish('done') : setI((n) => n + 1))}>
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
