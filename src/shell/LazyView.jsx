import { Suspense } from 'react';
import ChunkBoundary from './ChunkBoundary.jsx';

/** Keep a delayed or failed view download within its own surface. */
export default function LazyView({ children }) {
  return <ChunkBoundary><Suspense fallback={<div className="lazy-view-loading" role="status" aria-live="polite">Loading view…</div>}>{children}</Suspense></ChunkBoundary>;
}
