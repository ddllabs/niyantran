import { useEffect, useState, useMemo, useRef } from 'react';
import {
  fetchLiveTvChannels,
  fetchLiveTvSchedule,
  fetchLiveTvVideos,
  fetchLiveTvArchive,
  fetchLiveTvTranscript,
} from '../lib/liveTvClient.js';
import './liveTv.css';

export default function LiveTvModal({ open, onClose, onNavigateDesk }) {
  const [channels, setChannels] = useState([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [activeChannelId, setActiveChannelId] = useState('dd-news');
  const [playbackMode, setPlaybackMode] = useState('live'); // 'live' | 'archive'
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [streamError, setStreamError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [categories, setCategories] = useState(['ALL', 'NEWS', 'EDUCATION', 'POLITICS', 'ECONOMICS', 'RESEARCH', 'GENERAL']);
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Tabs: 'schedule' | 'videos' | 'archive' | 'transcript'
  const [activeTab, setActiveTab] = useState('schedule');
  const [schedule, setSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState(null);

  const [videos, setVideos] = useState([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const [videosError, setVideosError] = useState(null);
  const [activeVideo, setActiveVideo] = useState(null);

  const [archive, setArchive] = useState([]);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveError, setArchiveError] = useState(null);

  const [selectedBroadcastId, setSelectedBroadcastId] = useState('arch-dd-2026-09-26');
  const [transcript, setTranscript] = useState(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const [activeCueTimestamp, setActiveCueTimestamp] = useState(null);

  const playerContainerRef = useRef(null);

  // Load channels catalogue
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChannelsLoading(true);
    fetchLiveTvChannels().then((data) => {
      if (cancelled) return;
      setChannelsLoading(false);
      if (data.ok && Array.isArray(data.channels) && data.channels.length) {
        setChannels(data.channels);
        if (Array.isArray(data.categories) && data.categories.length) {
          setCategories(['ALL', ...data.categories.filter((c) => c !== 'ALL')]);
        }
        if (data.channels[0]) {
          setActiveChannelId((cur) => cur || data.channels[0].id);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load schedule and archive when active channel changes
  useEffect(() => {
    if (!open || !activeChannelId) return;
    let cancelled = false;
    setStreamError(false);
    setScheduleLoading(true);
    setScheduleError(null);
    setArchiveLoading(true);
    setArchiveError(null);

    fetchLiveTvSchedule(activeChannelId)
      .then((data) => {
        if (cancelled) return;
        setScheduleLoading(false);
        if (data.ok && Array.isArray(data.items)) {
          setSchedule(data.items);
        } else {
          setSchedule([]);
          if (data.error) setScheduleError(data.error);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setScheduleLoading(false);
        setScheduleError(err.message || 'Failed to load schedule');
      });

    setVideosLoading(true);
    setVideosError(null);
    fetchLiveTvVideos(activeChannelId)
      .then((data) => {
        if (cancelled) return;
        setVideosLoading(false);
        if (data.ok && Array.isArray(data.recentVideos)) {
          setVideos(data.recentVideos);
        } else {
          setVideos([]);
          if (data.error) setVideosError(data.error);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setVideosLoading(false);
        setVideosError(err.message || 'Failed to load videos');
      });

    fetchLiveTvArchive(activeChannelId)
      .then((data) => {
        if (cancelled) return;
        setArchiveLoading(false);
        if (data.ok && Array.isArray(data.items)) {
          const items = data.items;
          setArchive(items);
          if (items.length) {
            setSelectedBroadcastId((cur) => (items.some((it) => it.id === cur) ? cur : items[0].id));
          }
        } else {
          setArchive([]);
          if (data.error) setArchiveError(data.error);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setArchiveLoading(false);
        setArchiveError(err.message || 'Failed to load archive');
      });

    return () => {
      cancelled = true;
    };
  }, [open, activeChannelId]);

  // Load transcript when selected broadcast changes
  useEffect(() => {
    if (!open || !selectedBroadcastId) return;
    let cancelled = false;
    setTranscriptLoading(true);
    fetchLiveTvTranscript(selectedBroadcastId)
      .then((data) => {
        if (cancelled) return;
        setTranscriptLoading(false);
        setTranscript(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setTranscriptLoading(false);
        setTranscript({ ok: false, error: err.message, cues: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedBroadcastId]);

  const filteredChannels = useMemo(() => {
    if (!selectedCategory || selectedCategory === 'ALL') return channels;
    return channels.filter((c) => c.category === selectedCategory);
  }, [channels, selectedCategory]);

  function handlePlayVideo(video) {
    setActiveVideo(video);
    setSelectedBroadcastId(video.id || video.videoId);
    setPlaybackMode('video');
    setStreamError(false);
    setReloadKey((k) => k + 1);
  }

  const activeChannel = useMemo(() => {
    return channels.find((c) => c.id === activeChannelId) || channels[0] || null;
  }, [channels, activeChannelId]);

  const selectedArchiveItem = useMemo(() => {
    return archive.find((a) => a.id === selectedBroadcastId) || archive[0] || null;
  }, [archive, selectedBroadcastId]);

  const filteredCues = useMemo(() => {
    if (!transcript || !transcript.cues || !Array.isArray(transcript.cues)) return [];
    const q = transcriptQuery.trim().toLowerCase();
    if (!q) return transcript.cues;
    return transcript.cues.filter(
      (c) =>
        (c.text && c.text.toLowerCase().includes(q)) ||
        (c.speaker && c.speaker.toLowerCase().includes(q)),
    );
  }, [transcript, transcriptQuery]);

  function handleOpenDesk(deskId, feature) {
    if (typeof onNavigateDesk === 'function') {
      onNavigateDesk(deskId, feature);
      onClose();
    }
  }

  function handlePlayArchive(item) {
    setSelectedBroadcastId(item.id);
    setPlaybackMode('archive');
    setStreamError(false);
    setReloadKey((k) => k + 1);
  }

  function handleReturnToLive() {
    setPlaybackMode('live');
    setActiveVideo(null);
    setStreamError(false);
    setReloadKey((k) => k + 1);
  }

  function toggleFullscreen() {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // External watch URL for truthful fallback
  const externalWatchUrl = useMemo(() => {
    if (playbackMode === 'video' && activeVideo) {
      const vid = activeVideo.videoId || activeVideo.id;
      return vid ? `https://www.youtube.com/watch?v=${vid}` : activeChannel?.channelUrl || 'https://www.youtube.com';
    }
    if (playbackMode === 'archive' && selectedArchiveItem) {
      return selectedArchiveItem.videoUrl?.replace('/embed/', '/watch?v=').split('?')[0] || activeChannel?.channelUrl || 'https://www.youtube.com';
    }
    if (activeChannel?.defaultVideoId) {
      return `https://www.youtube.com/watch?v=${activeChannel.defaultVideoId}`;
    }
    return activeChannel?.channelUrl || 'https://www.youtube.com';
  }, [playbackMode, activeVideo, selectedArchiveItem, activeChannel]);

  // Determine current player source
  const currentEmbedUrl =
    playbackMode === 'video' && activeVideo
      ? activeVideo.embedUrl || ('https://www.youtube-nocookie.com/embed/' + (activeVideo.id || activeVideo.videoId) + '?autoplay=1&mute=1&playsinline=1')
      : playbackMode === 'archive' && selectedArchiveItem
      ? selectedArchiveItem.videoUrl
      : activeChannel?.embedUrl || '';

  const embedSrc = useMemo(() => {
    if (!currentEmbedUrl) return '';
    try {
      const originParam = typeof window !== 'undefined' && window.location.origin ? `&origin=${encodeURIComponent(window.location.origin)}` : '';
      const sep = currentEmbedUrl.includes('?') ? '&' : '?';
      return `${currentEmbedUrl}${sep}mute=${isMuted ? '1' : '0'}${originParam}`;
    } catch {
      return `${currentEmbedUrl}${currentEmbedUrl.includes('?') ? '&' : '?'}mute=${isMuted ? '1' : '0'}`;
    }
  }, [currentEmbedUrl, isMuted]);

  // After every hook: React needs the same hooks on every render.
  if (!open) return null;

  return (
    <div className="ltv-modal-backdrop" onClick={onClose}>
      <div
        className="ltv-modal"
        role="dialog"
        aria-label="Niyantran Live TV Workbench"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <header className="ltv-header">
          <div className="ltv-header-brand">
            <strong>NIYANTRAN LIVE TV</strong>
            {playbackMode === 'live' ? (
              streamError ? (
                <span className="ltv-offline-badge">
                  <span className="ltv-offline-dot" /> OFFLINE
                </span>
              ) : activeChannel?.status === 'live' ? (
                <span className="ltv-live-badge">
                  <span className="ltv-live-dot" /> LIVE FEED
                </span>
              ) : (
                <span className="ltv-recent-badge">
                  <span className="ltv-recent-dot" /> CURATED FEED
                </span>
              )
            ) : playbackMode === 'video' ? (
              <span className="ltv-video-playback-badge">
                <span className="ltv-video-dot" /> VIDEO PLAYBACK
              </span>
            ) : (
              <span className="ltv-archive-badge">
                <span className="ltv-archive-dot" /> ARCHIVE PLAYBACK
              </span>
            )}
            {playbackMode === 'archive' && selectedArchiveItem && (
              <span className="ltv-archive-pill">
                {selectedArchiveItem.duration} &bull; {selectedArchiveItem.date?.split('T')[0]}
              </span>
            )}
            {playbackMode === 'video' && activeVideo && (
              <span className="ltv-archive-pill">
                {activeVideo.duration} &bull; {activeVideo.publishedAt?.split('T')[0]}
              </span>
            )}
            {playbackMode === 'live' && (
              <span className="ltv-viewer-metric">
                {activeChannel?.viewers != null
                  ? `● ${activeChannel.viewers.toLocaleString()} viewers`
                  : '● Telemetry source: unmetered broadcast'}
              </span>
            )}
          </div>
          <button
            type="button"
            className="ltv-close-btn"
            onClick={onClose}
            aria-label="Close Live TV"
            title="Close Live TV"
          >
            ✕
          </button>
        </header>

        {/* Category Filter Bar */}
        <div className="ltv-category-bar" role="tablist" aria-label="Channel Categories">
          {categories.map((cat) => (
            <button
              type="button"
              key={cat}
              className={`ltv-category-pill${selectedCategory === cat ? ' active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Channel Selection Strip */}
        <nav className="ltv-strip-wrap" aria-label="Available Channels">
          {channelsLoading ? (
            <div className="ltv-strip-loading">Loading curated sources...</div>
          ) : filteredChannels.length === 0 ? (
            <div className="ltv-strip-loading">No channels found for {selectedCategory}</div>
          ) : (
            filteredChannels.map((ch) => (
              <button
                type="button"
                key={ch.id}
                className={`ltv-channel-chip${ch.id === activeChannelId && playbackMode === 'live' ? ' active' : ''}`}
                onClick={() => {
                  setActiveChannelId(ch.id);
                  setPlaybackMode('live');
                  setActiveVideo(null);
                  setStreamError(false);
                  setReloadKey((k) => k + 1);
                }}
                title={`${ch.name} (${ch.category} • ${ch.lang})`}
              >
                <span className="ltv-chip-tag" style={{ background: ch.color || '#3b82f6' }}>
                  {ch.short || ch.name.slice(0, 3)}
                </span>
                <span className="ltv-chip-name">{ch.name}</span>
                <span className={`ltv-chip-status ltv-chip-status-${ch.status || 'live'}`}>
                  {ch.status === 'live' ? 'LIVE' : ch.status === 'soon' ? 'SOON' : 'RECENT'}
                </span>
              </button>
            ))
          )}
        </nav>

        {/* Scrollable Modal Body */}
        <div className="ltv-body">
          {/* Player Stage */}
          <section className="ltv-player-stage">
            <div className="ltv-video-container" ref={playerContainerRef}>
              {streamError || !embedSrc ? (
                <div className="ltv-offline-card">
                  <h4>Stream Offline or Protected</h4>
                  <p>
                    The external broadcast stream for{' '}
                    {playbackMode === 'archive' ? selectedArchiveItem?.title : activeChannel?.name || 'this channel'}{' '}
                    is currently unavailable or restricted for direct embedding.
                  </p>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                    <a
                      href={externalWatchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ltv-action-btn primary"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      Watch on YouTube ↗
                    </a>
                    <button
                      type="button"
                      className="ltv-action-btn secondary"
                      onClick={() => {
                        setStreamError(false);
                        setReloadKey((k) => k + 1);
                      }}
                    >
                      Retry Broadcast Feed
                    </button>
                  </div>
                </div>
              ) : isPlaying ? (
                <iframe
                  key={`${activeChannelId}-${selectedBroadcastId}-${playbackMode}-${reloadKey}-${isMuted}`}
                  className="ltv-video-frame"
                  src={embedSrc}
                  title={`${playbackMode === 'archive' ? selectedArchiveItem?.title : activeChannel?.name || 'Live TV'} Player`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  referrerPolicy="strict-origin-when-cross-origin"
                  onError={() => setStreamError(true)}
                />
              ) : (
                <div className="ltv-offline-card">
                  <h4>Playback Paused</h4>
                  <p>Click Play to resume stream.</p>
                  <button
                    type="button"
                    className="ltv-action-btn primary"
                    onClick={() => setIsPlaying(true)}
                  >
                    Play
                  </button>
                </div>
              )}
            </div>

            {/* Player Metadata & Action Bar */}
            <div className="ltv-player-meta">
              <div className="ltv-program-info">
                <h3>
                  {playbackMode === 'archive'
                    ? selectedArchiveItem?.title || 'Archived Recording'
                    : activeChannel?.currentProgram || 'Authoritative Live Broadcast'}
                </h3>
                <p>
                  {playbackMode === 'archive' ? (
                    <>
                      Segment: {selectedArchiveItem?.segment || 'General'} &bull; Duration:{' '}
                      {selectedArchiveItem?.duration || 'Full'} &bull; Date:{' '}
                      {selectedArchiveItem?.date?.split('T')[0] || ''}
                    </>
                  ) : (
                    <>
                      {activeChannel?.name} &bull; {activeChannel?.category} &bull; Language:{' '}
                      {activeChannel?.lang}
                    </>
                  )}
                </p>
                {playbackMode === 'archive' && selectedArchiveItem?.topics && (
                  <div className="ltv-topics-wrap">
                    {selectedArchiveItem.topics.map((t, idx) => (
                      <span key={idx} className="ltv-topic-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="ltv-player-controls">
                {playbackMode === 'archive' && (
                  <button
                    type="button"
                    className="ltv-action-btn ltv-return-live-btn"
                    onClick={handleReturnToLive}
                    title="Return to Live Broadcast stream"
                  >
                    Return to Live Feed
                  </button>
                )}
                {activeChannel?.deskId && (
                  <button
                    type="button"
                    className="ltv-action-btn primary"
                    onClick={() => handleOpenDesk(activeChannel.deskId)}
                    title={`Open mapped ${activeChannel.deskId} desk`}
                  >
                    Open Desk: {activeChannel.deskId}
                  </button>
                )}
                <button
                  type="button"
                  className="ltv-action-btn"
                  onClick={() => setIsPlaying((p) => !p)}
                  title={isPlaying ? 'Pause Playback' : 'Play Stream'}
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  className="ltv-action-btn"
                  onClick={() => setIsMuted((m) => !m)}
                  title={isMuted ? 'Unmute Player' : 'Mute Player'}
                >
                  {isMuted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  type="button"
                  className="ltv-action-btn"
                  onClick={toggleFullscreen}
                  title="Fullscreen"
                >
                  Fullscreen
                </button>
                <button
                  type="button"
                  className="ltv-action-btn"
                  onClick={() => setReloadKey((k) => k + 1)}
                  title="Reload Live Feed"
                >
                  Reload Feed
                </button>
              </div>
            </div>
          </section>

          {/* Lower Section Tabs */}
          <nav className="ltv-deck-tabs" aria-label="Live TV Modules">
            <button
              type="button"
              className={`ltv-tab-btn${activeTab === 'schedule' ? ' active' : ''}`}
              onClick={() => setActiveTab('schedule')}
            >
              Broadcast Schedule ({schedule.length})
            </button>
            <button
              type="button"
              className={`ltv-tab-btn${activeTab === 'videos' ? ' active' : ''}`}
              onClick={() => setActiveTab('videos')}
            >
              Channel Videos ({videos.length})
            </button>
            <button
              type="button"
              className={`ltv-tab-btn${activeTab === 'archive' ? ' active' : ''}`}
              onClick={() => setActiveTab('archive')}
            >
              Archived Segments ({archive.length})
            </button>
            <button
              type="button"
              className={`ltv-tab-btn${activeTab === 'transcript' ? ' active' : ''}`}
              onClick={() => setActiveTab('transcript')}
            >
              Authoritative Transcript
            </button>
          </nav>

          {/* Tab Content */}
          <div className="ltv-tab-content">
            {activeTab === 'schedule' && (
              <div className="ltv-schedule-list">
                {scheduleLoading ? (
                  <div className="ltv-loading-spinner">
                    <span className="ltv-spinner-circle" /> Loading broadcast schedule...
                  </div>
                ) : scheduleError ? (
                  <div className="ltv-empty-msg">Schedule error: {scheduleError}</div>
                ) : schedule.length === 0 ? (
                  <div className="ltv-empty-msg">No schedule items published for this channel.</div>
                ) : (
                  schedule.map((item) => (
                    <div
                      key={item.id}
                      className={`ltv-schedule-item${item.isLive ? ' is-live' : ''}`}
                    >
                      <div className="ltv-schedule-time">
                        {item.startTime} &ndash; {item.endTime}
                      </div>
                      <div className="ltv-schedule-details">
                        <h4>
                          {item.title}
                          {item.isLive && <span className="ltv-badge-onair">ON AIR</span>}
                        </h4>
                        <p>{item.description}</p>
                      </div>
                      {item.deskId && (
                        <button
                          type="button"
                          className="ltv-action-btn"
                          onClick={() => handleOpenDesk(item.deskId)}
                        >
                          View Desk &rarr;
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'videos' && (
              <div className="ltv-videos-grid">
                {videosLoading ? (
                  <div className="ltv-loading-spinner">
                    <span className="ltv-spinner-circle" /> Loading channel videos...
                  </div>
                ) : videosError ? (
                  <div className="ltv-empty-msg">Videos error: {videosError}</div>
                ) : videos.length === 0 ? (
                  <div className="ltv-empty-msg">No recent videos available for this channel.</div>
                ) : (
                  videos.map((vid) => {
                    const vidId = vid.id || vid.videoId;
                    const isSelected =
                      activeVideo &&
                      (activeVideo.id === vidId || activeVideo.videoId === vidId) &&
                      playbackMode === 'video';
                    return (
                      <div
                        key={vidId || vid.title}
                        className={`ltv-video-card${isSelected ? ' is-selected' : ''}`}
                      >
                        <div className="ltv-video-card-thumb-wrap">
                          {vid.thumbnail ? (
                            <img
                              src={vid.thumbnail}
                              alt={vid.title}
                              className="ltv-video-card-thumb"
                              loading="lazy"
                            />
                          ) : (
                            <div className="ltv-video-card-thumb-fallback">
                              <span>{vid.duration || 'VIDEO'}</span>
                            </div>
                          )}
                          <span className="ltv-video-card-badge">{vid.duration || 'HD'}</span>
                        </div>
                        <div className="ltv-video-card-content">
                          <h4>{vid.title}</h4>
                          <div className="ltv-video-card-meta">
                            <span>{vid.publishedAt?.split('T')[0]}</span>
                            <span>&bull;</span>
                            <span>{vid.channelTitle || activeChannel?.name}</span>
                          </div>
                          {vid.description && (
                            <p className="ltv-video-card-desc">{vid.description}</p>
                          )}
                          <div className="ltv-player-controls" style={{ marginTop: '8px' }}>
                            <button
                              type="button"
                              className="ltv-action-btn primary"
                              onClick={() => handlePlayVideo(vid)}
                            >
                              Play Video
                            </button>
                            <button
                              type="button"
                              className="ltv-action-btn"
                              onClick={() => {
                                setSelectedBroadcastId(vidId);
                                setActiveTab('transcript');
                              }}
                            >
                              Transcript
                            </button>
                          </div>
                      </div>
                    </div>
                );
                })
              )}
            </div>
            )}

            {activeTab === 'archive' && (
              <div className="ltv-archive-grid">
                {archiveLoading ? (
                  <div className="ltv-loading-spinner">
                    <span className="ltv-spinner-circle" /> Loading archived broadcasts...
                  </div>
                ) : archiveError ? (
                  <div className="ltv-empty-msg">Archive error: {archiveError}</div>
                ) : archive.length === 0 ? (
                  <div className="ltv-empty-msg">No past broadcasts archived for this channel.</div>
                ) : (
                  archive.map((item) => {
                    const isSelected =
                      selectedBroadcastId === item.id && playbackMode === 'archive';
                    return (
                      <div
                        key={item.id}
                        className={`ltv-archive-card${isSelected ? ' is-selected' : ''}`}
                      >
                        <div>
                          <h4>{item.title}</h4>
                          <div className="ltv-archive-meta">
                            <span>{item.date.split('T')[0]}</span>
                            <span>&bull;</span>
                            <span>{item.duration}</span>
                            <span>&bull;</span>
                            <span>{item.segment}</span>
                          </div>
                          <p>{item.summary}</p>
                          {item.topics && (
                            <div className="ltv-topics-wrap">
                              {item.topics.map((t, idx) => (
                                <span key={idx} className="ltv-topic-tag">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="ltv-player-controls" style={{ marginTop: '8px' }}>
                          <button
                            type="button"
                            className="ltv-action-btn primary"
                            onClick={() => handlePlayArchive(item)}
                          >
                            Play Segment
                          </button>
                          <button
                            type="button"
                            className="ltv-action-btn"
                            onClick={() => {
                              setSelectedBroadcastId(item.id);
                              setActiveTab('transcript');
                            }}
                          >
                            {item.hasTranscript ? 'Read Transcript' : 'View Summary'}
                          </button>
                          {item.deskId && (
                            <button
                              type="button"
                              className="ltv-action-btn"
                              onClick={() => handleOpenDesk(item.deskId)}
                            >
                              Desk
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {activeTab === 'transcript' && (
              <div className="ltv-transcript-pane">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <input
                    type="search"
                    className="ltv-transcript-search"
                    placeholder="Search transcript cues..."
                    value={transcriptQuery}
                    onChange={(e) => setTranscriptQuery(e.target.value)}
                  />
                  {transcript?.source && (
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      Source: {transcript.source}
                    </span>
                  )}
                </div>

                {transcriptLoading ? (
                  <div className="ltv-loading-spinner">
                    <span className="ltv-spinner-circle" /> Loading transcript...
                  </div>
                ) : !transcript || transcript.available === false ? (
                  <div className="ltv-empty-msg">
                    {transcript?.message ||
                      'Transcript unavailable for this broadcast. No fabricated transcript generated.'}
                  </div>
                ) : filteredCues.length === 0 ? (
                  <div className="ltv-empty-msg">No transcript cues match your search.</div>
                ) : (
                  <div className="ltv-transcript-cues">
                    {filteredCues.map((cue, idx) => (
                      <div
                        key={idx}
                        className={`ltv-cue${activeCueTimestamp === cue.timestamp ? ' is-active' : ''}`}
                      >
                        <span
                          className="ltv-cue-time"
                          onClick={() => setActiveCueTimestamp(cue.timestamp)}
                          title="Click to anchor playback cue"
                        >
                          {cue.timestamp}
                        </span>
                        <span className="ltv-cue-speaker">{cue.speaker}:</span>
                        <span className="ltv-cue-text">{cue.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
