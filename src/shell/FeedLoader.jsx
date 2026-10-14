import { useEffect, useState } from 'react';

/**
 * Route-aware loader. After eight seconds, surface “Still loading” + optional source detail.
 */
export default function FeedLoader({ label = 'Loading feed…', sourceHint = '' }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setSlow(false);
    const t = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(t);
  }, [label]);

  return (
    <div className="feed-loader" role="status" aria-live="polite">
      <i className="spinner" />
      <div className="feed-loader-copy">
        <span>{slow ? 'Still loading…' : label}</span>
        {slow && (
          <small className="feed-loader-hint">
            {sourceHint || 'Checking source health. Large registers can take longer than usual.'}
          </small>
        )}
      </div>
    </div>
  );
}
