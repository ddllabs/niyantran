// F366: the Live TV channel card. Row one is the existing channel strip drawn as large tiles with arrows
// that scroll it; row two is the existing category filter drawn as chips with a channel count each.
// Presentational: the page owns the selection and the filtering, exactly as before.
import { useRef } from 'react';
import { channelSubline, segmentCounts } from './channelView.js';

// Moves the strip by most of its width; instant when the reader prefers reduced motion.
function scrollStrip(el, direction) {
  if (!el || typeof el.scrollBy !== 'function') return;
  let calm = false;
  try { calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  el.scrollBy({ left: direction * Math.max(160, Math.round(el.clientWidth * 0.8)), behavior: calm ? 'auto' : 'smooth' });
}

export function ChannelCard({ channels, visible, categories, selectedCategory, onSelectCategory, activeChannelId, playbackMode, loading, onSelectChannel }) {
  const strip = useRef(null);
  return (
    <div className="ltv-channelcard">
      <div className="ltv-row">
        <span className="ltv-row-label">TOP CHANNELS</span>
        <nav className="ltv-strip-wrap" aria-label="Available Channels">
          {loading ? (
            <div className="ltv-strip-loading">Loading curated sources...</div>
          ) : visible.length === 0 ? (
            <div className="ltv-strip-loading">No channels found for {selectedCategory}</div>
          ) : (
            <div className="ltv-strip" ref={strip}>
              {visible.map((ch) => {
                const active = ch.id === activeChannelId && playbackMode === 'live';
                return (
                  <button
                    type="button"
                    key={ch.id}
                    className={`ltv-channel-chip${active ? ' active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelectChannel(ch)}
                    title={`${ch.name} (${ch.category} • ${ch.lang})`}
                  >
                    <span className="ltv-chip-tag" style={{ background: ch.color || '#3b82f6' }}>
                      {ch.short || ch.name.slice(0, 3)}
                    </span>
                    <span className="ltv-chip-text">
                      <span className="ltv-chip-name">{ch.name}</span>
                      {channelSubline(ch) ? <span className={`ltv-chip-status ltv-chip-status-${ch.status || 'recent'}`}>{channelSubline(ch)}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="ltv-strip-arrows">
            <button type="button" className="ltv-arrow" aria-label="Scroll channels left" onClick={() => scrollStrip(strip.current, -1)}><span aria-hidden="true">‹</span></button>
            <button type="button" className="ltv-arrow" aria-label="Scroll channels right" onClick={() => scrollStrip(strip.current, 1)}><span aria-hidden="true">›</span></button>
          </div>
        </nav>
      </div>
      {/* F61 (F171 B15): filter buttons, so pressed state, not tabs (they never behaved like tabs). */}
      <div className="ltv-row">
        <span className="ltv-row-label">SEGMENTS</span>
        <div className="ltv-category-bar" role="group" aria-label="Channel Categories">
          {segmentCounts(channels, categories).map(({ category, count }) => (
            <button
              type="button"
              key={category}
              className={`ltv-category-pill${selectedCategory === category ? ' active' : ''}`}
              aria-pressed={selectedCategory === category}
              onClick={() => onSelectCategory(category)}
            >
              {category}{' '}
              <span className="ltv-category-count">{count}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
