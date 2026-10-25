import { useState } from 'react';
import { useNterLatest } from '../lib/nterNewsClient.js';
import { newsCheckLabel, newsPublication, isPublisherArtwork } from '../lib/homeNews.js';
import './nterLatestRail.css';
import PublisherBrand from '../desks/PublisherBrand.jsx';

function NewsImage({ src, alt }) {
  const [failed, setFailed] = useState(null);

  if (!src || failed === src) {
    return (
      <div className="nter-card-placeholder" aria-hidden="true">
        <span>NTER.NEWS</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      style={isPublisherArtwork(src) ? { objectFit: 'contain' } : undefined}
      alt={alt || ''}
      className="nter-card-img"
      loading="lazy"
      onError={() => setFailed(src)}
    />
  );
}

export default function NterLatestRail({ onLogin, limit = 8 }) {
  const { rows, loading, error, checked_at, archive, stale, waiting, note, refresh } = useNterLatest({
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
              Selected from <PublisherBrand />
            </span>
            <div>
              <h2 id="nter-rail-heading" className="nter-rail-title">
                NTER.news Intelligence Rail
              </h2>
              <p className="nter-rail-subtitle">
                Front-page reporting from nter.news, refreshed regularly.
              </p>
            </div>
          </div>
          <div className="nter-rail-meta">
            {checked_at ? (
              <span className="nter-rail-updated" title={`Last checked: ${checked_at}`}>
                {newsCheckLabel({ checked_at, archive, stale })}
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
            <h4>News temporarily unavailable</h4>
            <p>{error}</p>
            <button type="button" className="nter-retry-btn" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : !rows.length || waiting ? (
          <div className="nter-rail-empty">
            <h4>No stories available</h4>
            <p>{note || 'Waiting for published stories from nter.news.'}</p>
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
                    <span>{newsPublication(item.pub || item.published_at)}</span>
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
