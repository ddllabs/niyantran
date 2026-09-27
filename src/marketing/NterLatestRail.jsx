import { useState } from 'react';
import { useNterLatest } from '../lib/nterNewsClient.js';
import './nterLatestRail.css';

function NewsImage({ src, alt }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="nter-card-placeholder" aria-hidden="true">
        <span>NTER.NEWS</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || ''}
      className="nter-card-img"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function NterLatestRail({ onLogin, limit = 8 }) {
  const { rows, loading, error, updated, ageH, waiting, refresh } = useNterLatest({
    pollIntervalMs: 60000,
    limit,
  });

  return (
    <section className="nter-rail-section" aria-labelledby="nter-rail-heading">
      <div className="nter-rail-wrap">
        <header className="nter-rail-header">
          <div className="nter-rail-brand">
            <span className="nter-live-badge">
              <span className="nter-live-dot" aria-hidden="true" />
              Live Latest
            </span>
            <div>
              <h2 id="nter-rail-heading" className="nter-rail-title">
                NTER.news Intelligence Rail
              </h2>
              <p className="nter-rail-subtitle">
                Live stream of public reporting, policy briefs, and verified investigative developments.
              </p>
            </div>
          </div>
          <div className="nter-rail-meta">
            {updated ? (
              <span className="nter-rail-updated" title={`Last updated: ${updated}`}>
                As of {ageH != null && ageH < 1 ? '<1h ago' : ageH != null ? `${Math.round(ageH)}h ago` : 'just now'}
              </span>
            ) : null}
            <a
              href="https://nter.news"
              target="_blank"
              rel="noreferrer"
              className="nter-rail-external"
            >
              Visit nter.news
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
          </div>
        </header>

        {loading && !rows.length ? (
          <div className="nter-cards-grid" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="nter-card-skeleton">
                <div className="nter-skel-media" />
                <div className="nter-skel-body">
                  <div className="nter-skel-line short" />
                  <div className="nter-skel-line title" />
                  <div className="nter-skel-line" />
                </div>
              </div>
            ))}
          </div>
        ) : error && !rows.length ? (
          <div className="nter-rail-error" role="alert">
            <h4>Live Feed Disconnected</h4>
            <p>{error}</p>
            <button type="button" className="nter-retry-btn" onClick={refresh}>
              Retry Connection
            </button>
          </div>
        ) : !rows.length || waiting ? (
          <div className="nter-rail-empty">
            <h4>Waiting for Ingest</h4>
            <p>Waiting for live articles from nter.news. No headlines were invented.</p>
          </div>
        ) : (
          <div className="nter-cards-grid" data-testid="nter-latest-grid">
            {rows.map((item, idx) => (
              <a
                key={item.id || item.article_id || item.link || idx}
                href={item.link || '#'}
                target="_blank"
                rel="noreferrer"
                className="nter-news-card"
              >
                <div className="nter-card-media">
                  <NewsImage src={item.img} alt={item.title} />
                  {item.category ? (
                    <span className="nter-card-badge">{item.category}</span>
                  ) : null}
                </div>
                <div className="nter-card-body">
                  <h3 className="nter-card-headline" title={item.title}>
                    {item.title}
                  </h3>
                  {item.dek ? (
                    <p className="nter-card-summary">{item.dek}</p>
                  ) : null}
                  <div className="nter-card-footer">
                    <span className="nter-card-source">{item.src || 'nter.news'}</span>
                    <span>{item.ago || 'Recent'}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
