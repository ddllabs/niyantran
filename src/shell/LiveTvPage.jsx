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
import { LatestClaimStrip } from './factcheck/LatestClaimStrip.jsx';
import { latestVerdictClaim } from './factcheck/claimFilter.js';
import { leaveFullscreenThen } from './factcheck/leaveFullscreen.js';
import { ChannelCard } from './liveTv/ChannelCard.jsx';
import { nowPlayingLine } from './liveTv/channelView.js';
import { embedVideoId, playingTarget } from './factcheck/factCheckText.js';
import { useFactCheck } from './factcheck/useFactCheck.js';
import { useYoutubePlayer } from './liveTv/useYoutubePlayer.js';
import { buildEmbedSrc, embedFrameKey } from './liveTv/embed.js';
import { parseYoutubeLink, youtubeEmbedUrl, youtubeWatchUrl, playerErrorMessage, pastedVideoKind, isBlockingPlayerError } from './liveTv/youtubeLink.js';
import './liveTv.css';

const REAL_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LINK_CHANNEL_ID = 'youtube-link'; // what the fact-check server stores for a pasted video (any short text is accepted)
const SESSION_ACTIVE = new Set(['sharing', 'starting', 'running', 'ending']);
const SESSION_OPEN = new Set([...SESSION_ACTIVE, 'choosing']); // the panel is busy with a session or a start screen

// The channel's own video is live (the list says so, F374); a liveVideoId is a different video, found later.
const curatedLiveOf = (c) => c.status === 'live' && !c.liveVideoId;
// This page can swap the channel's written video for a live one: it is a real video, not live, not a pseudo id.
const switchableOf = (c) => !curatedLiveOf(c) && Boolean(embedVideoId(c.embedUrl));
const willPlayLive = (c) => curatedLiveOf(c) || (REAL_VIDEO_ID.test(c.liveVideoId || '') && switchableOf(c));

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
  // F377: the live video YouTube data reported for a channel whose written video is not live. `lookupLive` is
  // what the per-channel lookup said; `liveSwitch` is the video live mode plays instead of the written one. The
  // switch follows the newest candidate (the lookup, else the channel list) except under a running session on
  // the same video, and is reset when the page is opened again. Both name their channel.
  const [lookupLive, setLookupLive] = useState(null); // { channelId, videoId }
  const [liveSwitch, setLiveSwitch] = useState(null); // { channelId, videoId }
  const [channelsFresh, setChannelsFresh] = useState(false); // the list was read since the page was opened
  const sessionHeld = useRef(false); // a session is running on the video now playing: nothing may change it
  const sessionTargetRef = useRef(''); // the target the open session or start screen belongs to
  const sessionStatusRef = useRef('idle');
  const reopenChoose = useRef(false); // a switch closed the start screen the user opened: open it again
  const kindLatch = useRef(null); // { linkId, kind } of a pasted video, fixed when its session is confirmed
  // B4: a pasted YouTube link plays as its own mode ('link'). `pasted` is { videoId }; the field keeps what the
  // user typed (also after an error); `playerInfo` and `playerError` come from the player bridge.
  const [pasted, setPasted] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState(false); // false | 'invalid' | 'channel'
  const [pasteOpen, setPasteOpen] = useState(false); // phones: the field opens from a button
  const [playerInfo, setPlayerInfo] = useState(null);
  const [playerError, setPlayerError] = useState(null); // the player's error code, or null

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
    if (!sessionHeld.current) setChannelsFresh(false); // the list held from the last visit may be hours old
    fetchLiveTvChannels().then((data) => {
      if (cancelled) return;
      setChannelsLoading(false);
      if (data.ok && Array.isArray(data.channels) && data.channels.length) {
        setChannels(data.channels);
        setChannelsFresh(true);
        if (Array.isArray(data.categories) && data.categories.length) {
          setCategories(['ALL', ...data.categories.filter((c) => c !== 'ALL')]);
        }
        // the channel shown is the one the page works on: the first of the list when the chosen one is not in it
        setActiveChannelId((cur) => (data.channels.some((c) => c.id === cur) ? cur : data.channels[0].id));
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
    // Opened again, or another channel: forget what was found before, unless a session runs on this video.
    if (!sessionHeld.current) { setLookupLive(null); setLiveSwitch(null); }
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
        // Only an answer from YouTube data is taken: it names the live video, or says there is none.
        if (data.ok && data.dataOrigin === 'youtube-api') {
          const liveId = data.liveVideo?.videoId;
          setLookupLive(typeof liveId === 'string' && REAL_VIDEO_ID.test(liveId) ? { channelId: activeChannelId, videoId: liveId } : null);
        }
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

  // LIVE is shown only when the video being played is live. The watched channel says so from what is really
  // playing (the switched-to live video, or a curated video the list says is live); any other tile says LIVE
  // only when this page will play a live video when it is opened.
  const liveSwitchedId = liveSwitch && liveSwitch.channelId === activeChannelId ? liveSwitch.videoId : '';
  const shownChannels = useMemo(
    () => channels.map((c) => {
      const live = c.id === activeChannelId && playbackMode === 'live' ? Boolean(liveSwitchedId) || curatedLiveOf(c) : willPlayLive(c);
      return live === (c.status === 'live') ? c : { ...c, status: live ? 'live' : c.status === 'live' ? 'recent' : c.status };
    }),
    [channels, liveSwitchedId, activeChannelId, playbackMode],
  );
  const filteredChannels = useMemo(() => {
    if (!selectedCategory || selectedCategory === 'ALL') return shownChannels;
    return shownChannels.filter((c) => c.category === selectedCategory);
  }, [shownChannels, selectedCategory]);

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

  // The video live mode plays: the switched-to live video when there is one, else the written one.
  const liveEmbedUrl = liveSwitchedId
    ? `https://www.youtube-nocookie.com/embed/${liveSwitchedId}?autoplay=1&mute=1&playsinline=1`
    : activeChannel?.embedUrl || '';

  const selectedArchiveItem = useMemo(() => {
    return archive.find((a) => a.id === selectedBroadcastId) || archive[0] || null;
  }, [archive, selectedBroadcastId]);

  // My sessions names a pasted video's sessions (their channel id is the fixed LINK_CHANNEL_ID).
  const pastChannels = useMemo(() => [...channels, { id: LINK_CHANNEL_ID, name: 'YouTube link' }], [channels]);

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

  // B4: Back to channels, and picking a channel tile, both leave the pasted video. The field keeps its text.
  function leaveLink() {
    setPasted(null);
    setPlayerInfo(null);
    setPlayerError(null);
  }

  function handleBackToChannels() {
    leaveLink();
    setPlaybackMode('live');
    setStreamError(false);
    setReloadKey((k) => k + 1);
  }

  function handleLoadLink(e) {
    e?.preventDefault?.();
    const parsed = parseYoutubeLink(pasteText);
    if (!parsed.ok) { setPasteError(parsed.reason === 'channel' ? 'channel' : 'invalid'); return; }
    setPasteError(false);
    setPasteOpen(false);
    // On phones the field closes now; focus goes to the page title so it is not dropped to the page body.
    titleRef.current?.focus({ preventScroll: true });
    if (playbackMode === 'link' && pasted?.videoId === parsed.videoId) {
      // already playing: nothing changes unless it failed, then it is tried again
      if (playerError !== null) { setPlayerError(null); setStreamError(false); setReloadKey((k) => k + 1); }
      return;
    }
    setPasted({ videoId: parsed.videoId });
    setPlayerInfo(null);
    setPlayerError(null);
    setActiveVideo(null);
    setPlaybackMode('link');
    setIsPlaying(true);
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
    if (playbackMode === 'link' && pasted) return youtubeWatchUrl(pasted.videoId);
    if (playbackMode === 'video' && activeVideo) {
      const vid = activeVideo.videoId || activeVideo.id;
      return vid ? `https://www.youtube.com/watch?v=${vid}` : activeChannel?.channelUrl || 'https://www.youtube.com';
    }
    if (playbackMode === 'archive' && selectedArchiveItem) {
      return selectedArchiveItem.videoUrl?.replace('/embed/', '/watch?v=').split('?')[0] || activeChannel?.channelUrl || 'https://www.youtube.com';
    }
    if (liveSwitchedId) return `https://www.youtube.com/watch?v=${liveSwitchedId}`;
    if (activeChannel?.defaultVideoId) {
      return `https://www.youtube.com/watch?v=${activeChannel.defaultVideoId}`;
    }
    return activeChannel?.channelUrl || 'https://www.youtube.com';
  }, [playbackMode, pasted, activeVideo, selectedArchiveItem, activeChannel, liveSwitchedId]);

  // Determine current player source
  const linkId = playbackMode === 'link' && pasted ? pasted.videoId : '';
  const currentEmbedUrl =
    linkId
      ? youtubeEmbedUrl(linkId)
      : playbackMode === 'video' && activeVideo
      ? activeVideo.embedUrl || ('https://www.youtube-nocookie.com/embed/' + (activeVideo.id || activeVideo.videoId) + '?autoplay=1&mute=1&playsinline=1')
      : playbackMode === 'archive' && selectedArchiveItem
      ? selectedArchiveItem.videoUrl
      : liveEmbedUrl;

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
    onInfo: (info) => setPlayerInfo(info),
    onError: (code) => setPlayerError(code),
  });
  const applyMute = (next) => {
    nextEmbedMuted.current = next; // a fallback remount, or a later Play, mounts with this
    setIsMuted(next);
    player.requestMute(next);
  };

  // F344: fact-check. Added after the existing hooks; nothing above changed. What is playing is read
  // from the embed address, so it names the video that is really on screen.
  const factCheckVideoId = embedVideoId(currentEmbedUrl);
  // A pasted video is live unless the player shows it is not (see pastedVideoKind); live sessions stay private.
  // Fixed when a session is confirmed and kept until it is over (idle, ended or error): player information that
  // arrives later cannot turn a private live session into a shared recorded one, or the other way round.
  if (kindLatch.current && !SESSION_OPEN.has(sessionStatusRef.current)) kindLatch.current = null;
  const latchedKind = kindLatch.current && kindLatch.current.linkId === linkId ? kindLatch.current.kind : null;
  const linkLive = Boolean(linkId) && (latchedKind ?? pastedVideoKind(playerInfo)) === 'live';
  const treatAsLive = playbackMode === 'live' || linkLive;
  const linkBlocked = Boolean(linkId) && isBlockingPlayerError(playerError); // no target: nothing to fact-check
  const factCheckChannelId = linkId ? LINK_CHANNEL_ID : activeChannel?.id || '';
  const factCheckTarget = linkBlocked ? null : playingTarget(factCheckChannelId, playbackMode, factCheckVideoId);
  const factCheck = useFactCheck({
    open,
    target: factCheckTarget,
    // where the player is, for shared results on recorded videos
    getPosition: () => (treatAsLive ? null : player.getPosition()),
    // F363: "Re-analyze this block" moves a recorded video to the block's start
    seek: (s) => (treatAsLive ? false : player.seekS(s)),
    start: {
      videoId: factCheckVideoId,
      channelId: factCheckChannelId,
      videoKind: treatAsLive ? 'live' : 'recorded',
      startPositionS: null,
      // read when the user confirms: a recorded video starts from where it is playing now
      getStartPositionS: () => (treatAsLive ? null : player.getPositionS()),
      seed: {
        channel: linkId ? 'YouTube link' : activeChannel?.name || '',
        title: (linkId ? playerInfo?.title : playbackMode === 'video' ? activeVideo?.title : playbackMode === 'archive' ? selectedArchiveItem?.title : '') || '',
      },
    },
  });

  // F377: live mode plays the live video YouTube reported when the channel's own video is a real id that is not
  // live, and follows the newest report (the lookup, else the list read since the page opened): a different id
  // moves to it, none goes back to the written video. It never changes the video under a session that runs on
  // the video now playing. A session or start screen that belongs to another video (the channel was changed,
  // its session is ending) does not hold it back.
  const sessionStatus = factCheck.view?.session?.status;
  const sessionOpen = SESSION_OPEN.has(sessionStatus);
  const sessionTarget = sessionOpen ? sessionTargetRef.current || factCheckTarget || 'none' : '';
  const heldBySession = SESSION_ACTIVE.has(sessionStatus) && sessionTarget === (factCheckTarget || 'none');
  sessionHeld.current = heldBySession;
  sessionStatusRef.current = sessionStatus || 'idle';
  useEffect(() => { sessionTargetRef.current = sessionTarget; });
  const liveCandidate = (lookupLive && lookupLive.channelId === activeChannel?.id ? lookupLive.videoId : '') || (channelsFresh ? activeChannel?.liveVideoId : '') || '';
  const liveWanted = activeChannel && switchableOf(activeChannel) && REAL_VIDEO_ID.test(liveCandidate) ? liveCandidate : '';
  useEffect(() => {
    if (!activeChannel || heldBySession) return;
    if (liveSwitchedId === liveWanted) return;
    // a start screen the user opened is closed by the target change: it is opened again below
    if (sessionStatus === 'choosing' && playbackMode === 'live') reopenChoose.current = true;
    setLiveSwitch(liveWanted ? { channelId: activeChannel.id, videoId: liveWanted } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel, liveWanted, liveSwitchedId, heldBySession]);
  useEffect(() => {
    if (!reopenChoose.current) return;
    reopenChoose.current = false;
    factCheck.actions.choose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factCheckTarget]);

  // F366: the panel is open by default and shows an idle state; the start screen opens only when the user
  // presses its entry button (nothing here asks the controller to do anything on its own).
  const playable = isPlaying && !streamError;

  // F366: "See why" on the latest-claim strip asks the panel to show that claim's card (the token makes a
  // second press on the same claim count).
  const [seeWhy, setSeeWhy] = useState(null);

  // After every hook: React needs the same hooks on every render.
  if (!open) return null;

  const factCheckOffered = factCheck.view?.flag?.available === true;
  // Over the video only while a session runs: the "Fact-check on" pill and the newest claim with a verdict.
  const sessionRunning = factCheckOffered && factCheck.view?.session?.status === 'running';
  const latestClaim = sessionRunning
    ? latestVerdictClaim(factCheck.view.session.claims, { rechecks: factCheck.view.rechecks || {}, price: factCheck.view.flag.recheckCredits ?? null })
    : null;
  const tabs = [
    ['schedule', `Broadcast Schedule (${schedule.length})`],
    ['videos', `Channel Videos (${videos.length})`],
    ['archive', `Archived Segments (${archive.length})`],
    ['transcript', 'Transcript'],
    ...(factCheckOffered ? [['sessions', 'My sessions']] : []),
  ];
  // My sessions can stop being offered while it is the chosen tab: show Channel Videos then, so one tab stays
  // the tab stop and the panel is not empty.
  const shownTab = tabs.some(([id]) => id === activeTab) ? activeTab : 'videos';
  const linkTitle = playerInfo?.title || 'YouTube video';
  const programTitle = linkId
    ? linkTitle
    : playbackMode === 'archive'
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
            ) : liveSwitchedId || (activeChannel && curatedLiveOf(activeChannel)) ? (
              <span className="ltv-live-badge">
                <span className="ltv-live-dot" /> LIVE FEED
              </span>
            ) : (
              <span className="ltv-recent-badge">
                <span className="ltv-recent-dot" /> CURATED FEED
              </span>
            )
          ) : playbackMode === 'link' ? (
            <span className="ltv-video-playback-badge">
              <span className="ltv-video-dot" /> YOUTUBE LINK
            </span>
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
        {/* B4: paste a YouTube video or live link. On phones the field opens from a button. */}
        <form className={`ltv-paste${pasteOpen ? ' is-open' : ''}`} onSubmit={handleLoadLink} noValidate>
          <button
            type="button"
            className="ltv-action-btn ltv-paste-toggle"
            aria-expanded={pasteOpen}
            aria-controls="ltv-paste-body"
            onClick={() => setPasteOpen((o) => !o)}
          >
            Paste a link
          </button>
          <div className="ltv-paste-body" id="ltv-paste-body">
            <label className="ltv-sr-only" htmlFor="ltv-paste-input">Paste a YouTube video or live link</label>
            <input
              id="ltv-paste-input"
              type="text"
              className="ltv-paste-input"
              placeholder="Paste a YouTube video or live link"
              value={pasteText}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={pasteError !== false}
              aria-describedby={pasteError ? 'ltv-paste-error' : undefined}
              onChange={(e) => { setPasteText(e.target.value); setPasteError(false); }}
            />
            <button type="submit" className="ltv-action-btn primary ltv-paste-submit">Load video</button>
          </div>
          {pasteError ? (
            <p className="ltv-paste-error" id="ltv-paste-error" role="alert">{pasteError === 'channel' ? 'Paste the link of one video or live stream, not a channel page.' : "That doesn't look like a YouTube link."}</p>
          ) : null}
        </form>
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
          leaveLink();
          if (ch.id !== activeChannelId) {
            // a new selection decides afresh: forget what was decided for the channel left
            setLiveSwitch(null);
            setLookupLive(null);
          }
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
            ) : linkBlocked ? (
              <div className="ltv-offline-card" role="alert">
                <h4>Can't play this video here</h4>
                <p>{playerErrorMessage(playerError)}</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                  <a href={externalWatchUrl} target="_blank" rel="noopener noreferrer" className="ltv-action-btn primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    Open on YouTube ↗
                  </a>
                </div>
              </div>
            ) : isPlaying ? (
              <iframe
                key={embedFrameKey({ channelId: activeChannelId, broadcastId: selectedBroadcastId, mode: playbackMode, reloadKey }) + (playbackMode === 'live' && liveSwitchedId ? `-${liveSwitchedId}` : '') + (linkId ? `-link-${linkId}` : '')}
                ref={player.iframeRef}
                className="ltv-video-frame"
                src={embedSrc}
                title={`${linkId ? linkTitle : playbackMode === 'archive' ? selectedArchiveItem?.title : activeChannel?.name || 'Live TV'} Player`}
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
            {sessionRunning ? (
              <>
                <span className="ltv-fcpill"><span className="ltv-fcpill-dot" aria-hidden="true" />Fact-check on</span>
                <LatestClaimStrip latest={latestClaim} onSee={(claimId) => leaveFullscreenThen(document, () => setSeeWhy((r) => ({ claimId, token: (r?.token || 0) + 1 })))} />
              </>
            ) : null}
          </div>

          </section>

          {/* Now playing: the tile, the title, the line, and the existing action buttons */}
          <div className="ltv-nowplaying">
            <span className="ltv-np-tile" style={{ background: linkId ? '#c4302b' : activeChannel?.color || '#3b82f6' }} aria-hidden="true">
              {linkId ? 'YT' : activeChannel ? activeChannel.short || activeChannel.name.slice(0, 3) : ''}
            </span>
            <div className="ltv-program-info">
              <h3>{programTitle}</h3>
              <p className="ltv-np-line">
                {linkId ? (
                  ['YouTube link', playerInfo?.isLive === true ? 'Live' : pastedVideoKind(playerInfo) === 'recorded' ? 'Video' : ''].filter(Boolean).join(' · ')
                ) : playbackMode === 'archive' ? (
                  <>
                    Segment: {selectedArchiveItem?.segment || 'General'} &bull; Duration:{' '}
                    {selectedArchiveItem?.duration || 'Full'} &bull; Date:{' '}
                    {selectedArchiveItem?.date?.split('T')[0] || ''}
                  </>
                ) : (
                  nowPlayingLine({ mode: playbackMode, channel: activeChannel })
                )}
              </p>
              {linkId && playerError !== null && !linkBlocked ? (
                <p className="ltv-np-note" role="status">The player reported a problem with this video.</p>
              ) : null}
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
              {linkId && (
                <>
                  <button type="button" className="ltv-action-btn ltv-return-live-btn" onClick={handleBackToChannels} title="Back to the channels">
                    Back to channels
                  </button>
                  <a href={externalWatchUrl} target="_blank" rel="noopener noreferrer" className="ltv-action-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                    Watch on YouTube ↗
                  </a>
                </>
              )}
              {!linkId && activeChannel?.deskId && (
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
                onClick={() => { setPlayerError(null); setReloadKey((k) => k + 1); }}
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
              channelName={linkId ? 'YouTube video' : activeChannel?.name || ''}
              playable={playable}
              onChoose={factCheck.actions.choose}
              view={factCheck.view}
              isMuted={isMuted}
              onUnmute={() => applyMute(false)}
              onConfirm={(minutes, price) => {
                if (linkId) kindLatch.current = { linkId, kind: treatAsLive ? 'live' : 'recorded' };
                factCheck.actions.confirm(minutes, price);
              }}
              onCancel={factCheck.actions.cancel}
              onStop={factCheck.actions.stop}
              onRetry={factCheck.actions.retry}
              onDismiss={factCheck.actions.dismiss}
              onEndOrphan={factCheck.actions.endOrphan}
              focusRequest={seeWhy}
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
              aria-selected={shownTab === id}
              aria-controls="ltv-tab-panel"
              tabIndex={shownTab === id ? 0 : -1}
              className={`ltv-tab-btn${shownTab === id ? ' active' : ''}`}
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
        <div className="ltv-tab-content" id="ltv-tab-panel" role="tabpanel" aria-labelledby={`ltv-tab-${shownTab}`}>
          {shownTab === 'schedule' && (
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

          {shownTab === 'videos' && (
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

          {shownTab === 'archive' && (
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

          {shownTab === 'transcript' && (
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
          <div hidden={!factCheckOffered || shownTab !== 'sessions'}>
            <PastSessions userId={factCheck.view?.flag?.userId} enabled={factCheckOffered} sessionStatus={factCheck.view?.session?.status} channels={pastChannels} />
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
