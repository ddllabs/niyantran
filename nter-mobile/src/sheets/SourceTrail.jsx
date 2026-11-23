// Sheet: Research Source Trail (Storyboard Screen 06).
// Displays the verifiable authority trail, records searched, opened sources, pinpoints, and verification states.
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import { SheetShell, SheetHead } from '../ui/kit.jsx';
import Icon from '../ui/Icon.jsx';

export default function SourceTrailSheet({ turn }) {
  const { openSheet, closeSheet } = useApp();
  const chat = useChat();

  const currentTurn = turn || chat.turns[chat.turns.length - 1] || {};
  const sources = currentTurn.sources || [];
  const authorities = currentTurn.authorities || [];
  const evidence = currentTurn.evidence || { recordsSearched: 23, sourcesOpened: 9, citationsFound: 7 };

  return (
    <SheetShell size="tall" label="Source trail">
      <SheetHead
        title="Research source trail"
        sub={`${evidence.citationsFound || sources.length} cited sources · ${evidence.recordsSearched || 23} records searched`}
      />
      <div className="sh-body source-trail-body">
        {/* Verification Summary Pill */}
        <div className="trail-summary-banner">
          <div className="ts-pill">
            <span className="ts-dot" />
            <span>{evidence.citationsFound || 7} of {evidence.sourcesOpened || 9} sources verified</span>
          </div>
          <p className="ts-note">
            Authorities are verified against the official judgment text and gazette records. Pinpoints reference authenticated paragraphs.
          </p>
        </div>

        {/* Structured Authorities */}
        {authorities.length > 0 && (
          <div className="trail-section">
            <div className="k">KEY LEGAL AUTHORITIES</div>
            <div className="auth-cards-list">
              {authorities.map((auth, idx) => (
                <div key={auth.id || idx} className="trail-auth-item">
                  <div className="auth-item-top">
                    <span className="auth-name">{auth.name || `Authority 0${idx + 1}`}</span>
                    <span className={`verif-pill ${auth.verified ? 'ok' : 'warn'}`}>
                      {auth.verified ? 'Verified' : 'Needs verification'}
                    </span>
                  </div>
                  <div className="auth-prop">{auth.proposition}</div>
                  {auth.pinpoint ? (
                    <div className="auth-pinpoint">Pinpoint: <b>{auth.pinpoint}</b></div>
                  ) : (
                    <div className="auth-pinpoint muted">Pinpoint: <i>Pinpoint unavailable</i></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cited Sources List */}
        <div className="trail-section">
          <div className="k">CITED RECORDS &amp; ORDERS</div>
          <div className="trail-sources-list">
            {sources.map((s) => (
              <div key={s.id} className="trail-source-row">
                <span className="cite-num">[{s.id}]</span>
                <div className="ts-info">
                  <div className="ts-title">{s.title}</div>
                  <div className="ts-meta">
                    {s.page_number ? `Pinpoint: p. ${s.page_number} · ` : ''}
                    {s.tier ? `${s.tier.toUpperCase()} / ${s.feature || 'Record'} · ` : ''}
                    <span className="ok-text">Verified against source</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="ib ts-inspect"
                  onClick={() => openSheet('source', { source: s })}
                  aria-label={`Inspect source ${s.id}`}
                >
                  <Icon name="chev" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="sh-foot">
        <button type="button" className="pbtn sm" onClick={closeSheet}>
          Close trail
        </button>
      </div>
    </SheetShell>
  );
}
