// F366 slice B: the newest verdict over the video, bottom-left, above the player's own controls. Not a live
// region: the panel's own announcer (fc-sr) already speaks each verdict, and a second region would say it
// twice. "See why" hands the claim id to the page, which asks the panel to show that card. The page draws it
// only while a session runs.
export function LatestClaimStrip({ latest, onSee }) {
  return (
    <div className="ltv-claimstrip-live">
      {latest ? (
        <div className="ltv-claimstrip">
          <span className={`fc-badge fc-badge--${latest.badge.key}`}>
            <span className="fc-glyph" aria-hidden="true">{latest.badge.glyph}</span>
            {` ${latest.badge.label}`}
          </span>
          <span className="ltv-claimstrip-text" dir="auto">{latest.claim.claim_en}</span>
          <button
            type="button"
            className="ltv-claimstrip-btn"
            data-fc="see-why"
            aria-label={`See why: ${latest.claim.claim_en}`}
            onClick={() => onSee(latest.claim.id)}
          >
            See why
          </button>
        </div>
      ) : null}
    </div>
  );
}
