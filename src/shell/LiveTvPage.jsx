import { useEffect, useState, useMemo, useRef } from 'react';
import {
  fetchLiveTvChannels,
  fetchLiveTvSchedule,
  fetchLiveTvVideos,
  fetchLiveTvArchive,
  fetchLiveTvTranscript,
} from '../lib/liveTvClient.js';
import { FactCheckPanel } from './factcheck/FactCheckPanel.jsx';
import { PastSessions } from './factcheck/PastSessions.jsx';
import { ChannelCard } from './liveTv/ChannelCard.jsx';
import { shouldAutoChoose } from './liveTv/autoChoose.js';
import { nowPlayingLine } from './liveTv/channelView.js';
import { embedVideoId, playingTarget } from './factcheck/factCheckText.js';
import { useFactCheck } from './factcheck/useFactCheck.js';
import { useYoutubePlayer } from './liveTv/useYoutubePlayer.js';
import { buildEmbedSrc, embedFrameKey } from './liveTv/embed.js';
import './liveTv.css';

// F359: a shell page at #/livetv. `open` says whether it is the page being shown; it stays mounted after the
// first visit and draws nothing while closed. `onClose` is Back (the shell decides where to).
export default function LiveTvPage({ open, onClose, onNavigateDesk }) {
  const [channels, setChannels] = useState([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [activeChannelId, setActiveChannelId] = useState('dd-news');
  const [playbackMode, setPlaybackMode] = useState('live'); // 'live' | 'archive'
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const nextEmbedMuted = useRef(true); // the mute a NEW embed mounts with; a mute toggle never rebuilds a mounted one
  const [streamError, setStreamError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [categories, setCategories] = useState(['ALL', 'NEWS', 'EDUCATION', 'POLITICS', 'ECONOMICS', 'RESEARCH', 'GENERAL']);
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Tabs: 'schedule' | 'videos' | 'archive' | 'transcript'
  // F7: videos first; the schedule, archive and transcripts are empty until a real source exists.
  const [activeTab, setActiveTab] = useState('videos');
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

  const [selectedBroadcastId, setSelectedBroadcastId] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const [activeCueTimestamp, setActiveCueTimestamp] = useState(null);

  const playerContainerRef = useRef(null);
  const titleRef = useRef(null);

  // On opening, focus moves to the page heading (the fact-check panel does the same for its title); a
  // re-render does not take it again, only a new visit does.
  useEffect(() => {
    if (open) titleRef.current?.focus({ preventScroll: true });
  }, [open]);

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

  // Rebuilt only when a new iframe will mount (address, Reload Feed, Pause/Play, open), so it carries
  // the current mute then; a mute toggle alone leaves the mounted iframe's address alone.
  const embedSrc = useMemo(
    () => buildEmbedSrc({
      url: currentEmbedUrl,
      muted: nextEmbedMuted.current,
      origin: typeof window !== 'undefined' ? window.location.origin : '',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentEmbedUrl, reloadKey, isPlaying, open],
  );

  const player = useYoutubePlayer(open, {
    onMutedChange: (m) => { nextEmbedMuted.current = m; setIsMuted(m); },
    onFallback: () => setReloadKey((k) => k + 1),
  });
  const applyMute = (next) => {
    nextEmbedMuted.current = next; // a fallback remount, or a later Play, mounts with this
    setIsMuted(next);
    player.requestMute(next);
  };

  // F344: fact-check. Added after the existing hooks; nothing above changed. What is playing is read
  // from the embed address, so it names the video that is really on screen.
  const factCheckVideoId = embedVideoId(currentEmbedUrl);
  const factCheckChannelId = activeChannel?.id || '';
  const factCheckTarget = playingTarget(factCheckChannelId, playbackMode, factCheckVideoId);
  const factCheck = useFactCheck({
    open,
    target: factCheckTarget,
    // where the player is, for shared results on recorded videos
    getPosition: () => (playbackMode === 'live' ? null : player.getPosition()),
    // F363: "Re-analyze this block" moves a recorded video to the block's start
    seek: (s) => (playbackMode === 'live' ? false : player.seekS(s)),
    start: {
      videoId: factCheckVideoId,
      channelId: factCheckChannelId,
      videoKind: playbackMode === 'live' ? 'live' : 'recorded',
      startPositionS: null,
      // read when the user confirms: a recorded video starts from where it is playing now
      getStartPositionS: () => (playbackMode === 'live' ? null : player.getPositionS()),
      seed: {
        channel: activeChannel?.name || '',
        title: (playbackMode === 'video' ? activeVideo?.title : playbackMode === 'archive' ? selectedArchiveItem?.title : '') || '',
      },
    },
  });

  // F366: the panel is open by default, so its start screen opens by itself, once for each thing played
  // (the same conditions as the old entry button; Cancel is respected). A new visit starts afresh.
  const playable = isPlaying && !streamError;
  const autoChosen = useRef(null);
  useEffect(() => {
    if (!open) { autoChosen.current = null; return; }
    if (shouldAutoChoose({ view: factCheck.view, playable, key: factCheckTarget, done: autoChosen.current })) {
      autoChosen.current = factCheckTarget;
      factCheck.actions.choose();
    }
  });

  // After every hook: React needs the same hooks on every render.
  if (!open) return null;

  const factCheckOffered = factCheck.view?.flag?.available === true;
  const tabs = [
    ['schedule', `Broadcast Schedule (${schedule.length})`],
    ['videos', `Channel Videos (${videos.length})`],
    ['archive', `Archived Segments (${archive.length})`],
    ['transcript', 'Transcript'],
    ...(factCheckOffered ? [['sessions', 'My sessions']] : []),
  ];
  const programTitle = playbackMode === 'archive'
    ? selectedArchiveItem?.title || 'Archived Recording'
    : (playbackMode === 'video' && activeVideo?.title) || activeChannel?.name || '';

  return (
    <section className="ltv-page" aria-label="Live TV">
      {/* Top Header */}
      <header className="ltv-header">
        <div className="ltv-header-brand">
          <button type="button" className="ltv-back-btn" onClick={onClose} title="Back">
            <span aria-hidden="true">←</span> Back
          </button>
          <div className="ltv-titleblock">
            <h2 className="ltv-title" tabIndex={-1} ref={titleRef}>Live TV</h2>
            <p className="ltv-tagline">
              {factCheckOffered
                ? 'Watch and fact-check debates, speeches and bulletins as they happen.'
                : 'Watch debates, speeches and bulletins as they happen.'}
            </p>
          </div>
          <div className="ltv-header-badges">
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
              {[activeVideo.duration, activeVideo.publishedAt?.split('T')[0]].filter(Boolean).join(' • ')}
            </span>
          )}
          {playbackMode === 'live' && (
            <span className="ltv-viewer-metric">
              {activeChannel?.viewers != null
                ? `● ${activeChannel.viewers.toLocaleString()} viewers`
                : ''}
            </span>
          )}
          </div>
        </div>
      </header>

      {/* Scrollable page body: the channel card, the video and panel, then the lower tabs (liveTv.css) */}
      <div className="ltv-main">
      <ChannelCard
        channels={channels}
        visible={filteredChannels}
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        activeChannelId={activeChannelId}
        playbackMode={playbackMode}
        loading={channelsLoading}
        onSelectChannel={(ch) => {
          setActiveChannelId(ch.id);
          setPlaybackMode('live');
          setActiveVideo(null);
          setStreamError(false);
          setReloadKey((k) => k + 1);
        }}
      />

      <div className="ltv-body">
        <div className={`ltv-split${factCheckOffered ? ' has-panel' : ''}`}>
        <div className="ltv-videocol">
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
                key={embedFrameKey({ channelId: activeChannelId, broadcastId: selectedBroadcastId, mode: playbackMode, reloadKey })}
                ref={player.iframeRef}
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

          </section>

          {/* Now playing: the tile, the title, the line, and the existing action buttons */}
          <div className="ltv-nowplaying">
            <span className="ltv-np-tile" style={{ background: activeChannel?.color || '#3b82f6' }} aria-hidden="true">
              {activeChannel ? activeChannel.short || activeChannel.name.slice(0, 3) : ''}
            </span>
            <div className="ltv-program-info">
              <h3>{programTitle}</h3>
              <p className="ltv-np-line">
                {playbackMode === 'archive' ? (
                  <>
                    Segment: {selectedArchiveItem?.segment || 'General'} &bull; Duration:{' '}
                    {selectedArchiveItem?.duration || 'Full'} &bull; Date:{' '}
                    {selectedArchiveItem?.date?.split('T')[0] || ''}
                  </>
                ) : (
                  nowPlayingLine({ mode: playbackMode, channel: activeChannel })
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
                onClick={() => applyMute(!isMuted)}
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
        </div>

        {factCheckOffered ? (
          <div className="ltv-panelcol">
            <FactCheckPanel
              persistent
              channelName={activeChannel?.name || ''}
              playable={playable}
              onChoose={factCheck.actions.choose}
              view={factCheck.view}
              isMuted={isMuted}
              onUnmute={() => applyMute(false)}
              onConfirm={factCheck.actions.confirm}
              onCancel={factCheck.actions.cancel}
              onStop={factCheck.actions.stop}
              onRetry={factCheck.actions.retry}
              onDismiss={factCheck.actions.dismiss}
              onEndOrphan={factCheck.actions.endOrphan}
            />
          </div>
        ) : null}
        </div>

        {/* Lower Section Tabs */}
        {/* F61 (F171 B15): real tabs: one tab stop, arrows, Home and End move between them. */}
        <div className="ltv-deck-tabs" role="tablist" aria-label="Live TV Modules">
          {tabs.map(([id, label], index, all) => (
            <button
              type="button"
              key={id}
              id={`ltv-tab-${id}`}
              role="tab"
              aria-selected={activeTab === id}
              aria-controls="ltv-tab-panel"
              tabIndex={activeTab === id ? 0 : -1}
              className={`ltv-tab-btn${activeTab === id ? ' active' : ''}`}
              onClick={() => setActiveTab(id)}
              onKeyDown={(e) => {
                const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: all.length - 1 };
                if (!(e.key in keys)) return;
                e.preventDefault();
                const next = all[(keys[e.key] + all.length) % all.length][0];
                setActiveTab(next);
                e.currentTarget.parentElement?.querySelector(`#ltv-tab-${next}`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="ltv-tab-content" id="ltv-tab-panel" role="tabpanel" aria-labelledby={`ltv-tab-${activeTab}`}>
          {activeTab === 'schedule' && (
            <div className="ltv-schedule-list">
              {scheduleLoading ? (
                <div className="ltv-loading-spinner">
                  <span className="ltv-spinner-circle" /> Loading broadcast schedule...
                </div>
              ) : scheduleError ? (
                <div className="ltv-empty-msg">Schedule error: {scheduleError}</div>
              ) : schedule.length === 0 ? (
                <div className="ltv-empty-msg">Schedule not published.</div>
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
                        {vid.duration ? <span className="ltv-video-card-badge">{vid.duration}</span> : null}
                      </div>
                      <div className="ltv-video-card-content">
                        <h4>{vid.title}</h4>
                        <div className="ltv-video-card-meta">
                          {vid.publishedAt ? (
                            <>
                              <span>{vid.publishedAt.split('T')[0]}</span>
                              <span>&bull;</span>
                            </>
                          ) : null}
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
                <div className="ltv-empty-msg">No archived broadcasts.</div>
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
                          {item.hasTranscript ? 'Read Transcript' : 'No transcript'}
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
              ) : !transcript || !transcript.ok || transcript.available === false ? (
                <div className="ltv-empty-msg">{transcript?.message || 'No transcript available.'}</div>
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

          {/* F360/F366: the user's finished fact-check sessions are the "My sessions" tab. The section stays
              mounted (hidden) while another tab shows, as it was always mounted below the page, so it loads and
              reloads as before and an open delete question is not lost on a tab change. */}
          <div hidden={!factCheckOffered || activeTab !== 'sessions'}>
            <PastSessions userId={factCheck.view?.flag?.userId} enabled={factCheckOffered} sessionStatus={factCheck.view?.session?.status} channels={channels} />
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
