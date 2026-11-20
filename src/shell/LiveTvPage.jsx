import { useEffect, useState, useMemo, useRef } from 'react';
import {
  fetchLiveTvChannels,
  fetchLiveTvSchedule,
  fetchLiveTvVideos,
  fetchLiveTvArchive,
} from '../lib/liveTvClient.js';
import { FactCheckPanel } from './factcheck/FactCheckPanel.jsx';
import { PastSessions } from './factcheck/PastSessions.jsx';
import { LatestClaimStrip } from './factcheck/LatestClaimStrip.jsx';
import { latestVerdictClaim } from './factcheck/claimFilter.js';
import { leaveFullscreenThen } from './factcheck/leaveFullscreen.js';
import { ChannelCard } from './liveTv/ChannelCard.jsx';
import { ChannelBar } from './liveTv/ChannelBar.jsx';
import { browserStorage, readFollowing, writeFollowing, toggleFollowing, FOLLOW_KEY, FOLLOW_FULL, FOLLOW_MAX } from './liveTv/following.js';
import { TABS } from '../desks/tabs.js';
import { nowPlayingLine } from './liveTv/channelView.js';
import { embedVideoId, playingTarget } from './factcheck/factCheckText.js';
import { useFactCheck } from './factcheck/useFactCheck.js';
import { useYoutubePlayer } from './liveTv/useYoutubePlayer.js';
import { buildEmbedSrc, embedFrameKey } from './liveTv/embed.js';
import { remainingSecondsOf } from './liveTv/position.js';
import { parseYoutubeLink, youtubeEmbedUrl, youtubeWatchUrl, playerErrorMessage, pastedVideoKind, isBlockingPlayerError } from './liveTv/youtubeLink.js';
import './liveTv.css';

const REAL_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LINK_CHANNEL_ID = 'youtube-link'; // what the fact-check server stores for a pasted video (any short text is accepted)
const SESSION_ACTIVE = new Set(['sharing', 'starting', 'running', 'ending']);
const SESSION_OPEN = new Set([...SESSION_ACTIVE, 'choosing']); // the panel is busy with a session or a start screen

// How long a read of the channel list is believed about who is live (the server keeps its own answer that long).
const LIST_MAX_AGE_MS = 10 * 60 * 1000;
const TAB_IDS = new Set(TABS.map((t) => t.id));
// The list's "live" is about the channel's own video; a liveVideoId is a different video, found later.
const listLiveOf = (c) => c.status === 'live' && !c.liveVideoId;
// This page can play a live video for the channel: its written video is a real one that is not live, a remembered
// one (confirmed live by the list, so replaceable), or it has none.
const switchableOf = (c, trusted) => !trusted && (!c.embedUrl || Boolean(c.hinted) || Boolean(embedVideoId(c.embedUrl)));
// A tile says LIVE for a channel other than the one watched only while the list is young, and only if this page
// would play a live video when the channel is opened.
const willPlayLive = (c, listFresh) => listFresh && (listLiveOf(c) || (REAL_VIDEO_ID.test(c.liveVideoId || '') && switchableOf(c, false)));

// F359: a shell page at #/livetv. `open` says whether it is the page being shown; it stays mounted after the
// first visit and draws nothing while closed. `onClose` is kept for the shell; the page has no Back button of its own (the shell's navigation leaves it).
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
  // `lookupInfo` is what the per-channel lookup said for its channel: { channelId, videoId ('' = no live video),
  // authoritative (the answer came from YouTube data, so "none" is true), reason }. null while it is out.
  const [lookupInfo, setLookupInfo] = useState(null);
  const [liveSwitch, setLiveSwitch] = useState(null); // { channelId, videoId }
  const [listReadAt, setListReadAt] = useState(0); // when the channel list was last read (ms); 0 = not yet
  const [, setClock] = useState(0); // bumped when the list turns old, so the page draws without a stale LIVE
  const [channelsNonce, setChannelsNonce] = useState(0); // a pick after the list turned old reads it again
  const [videosOwner, setVideosOwner] = useState(''); // the channel `videos` belongs to
  const [barModal, setBarModal] = useState(false); // the phone sheet is open: the page behind it is inert
  const [followNote, setFollowNote] = useState('');
  const [refusedIds, setRefusedIds] = useState(() => new Map()); // live videos the player refused to show here: id -> { code, channelId }
  const refusedFrozen = useRef(new Map()); // the refusals as they were when no session held the video
  const channelIdRef = useRef('');
  const playingIdRef = useRef(null); // the video id on screen, and the mode, for the player's error callback
  const modeRef = useRef('live');
  const contradictedRef = useRef(false); // whether YouTube data contradicted the list when no session held the video
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

  const [lists, setLists] = useState([]); // the client's ten lists, from the server; none means the older category card
  const [followIds, setFollowIds] = useState(() => readFollowing(browserStorage())); // "My list", this browser only
  const [lookupNonce, setLookupNonce] = useState(0); // Reload on the not-live card asks the lookup again
  const [connectingLong, setConnectingLong] = useState(false);
  const [categories, setCategories] = useState(['ALL', 'NEWS', 'EDUCATION', 'POLITICS', 'ECONOMICS', 'RESEARCH', 'GENERAL']);
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Tabs: 'schedule' | 'videos' | 'archive' | 'sessions'
  // F7: videos first; the schedule and archive are empty until a real source exists.
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

  const playerContainerRef = useRef(null);
  const titleRef = useRef(null);

  // On opening, focus moves to the channel name beside the player (the fact-check panel does the same for its
  // title); a re-render does not take it again, only a new visit does.
  useEffect(() => {
    if (open) titleRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Load channels catalogue
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchLiveTvChannels().then((data) => {
      if (cancelled) return;
      setChannelsLoading(false);
      if (data.ok && Array.isArray(data.channels) && data.channels.length) {
        setChannels(data.channels);
        setLists(Array.isArray(data.lists) ? data.lists : []);
        setListReadAt(Date.now());
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
  }, [open, channelsNonce]);

  // What the list and a lookup say about who is live is believed for ten minutes; the page draws again when that
  // is over (the video keeps playing; only the word LIVE goes). Nothing is asked of the server by this.
  const lookupAt = lookupInfo && lookupInfo.authoritative && lookupInfo.videoId ? lookupInfo.at : 0;
  useEffect(() => {
    const now = Date.now();
    const waits = [listReadAt, lookupAt].filter(Boolean).map((t) => t + LIST_MAX_AGE_MS - now).filter((w) => w > 0);
    if (!waits.length) return undefined;
    const timer = setTimeout(() => setClock((n) => n + 1), Math.min(...waits) + 50);
    return () => clearTimeout(timer);
  }, [listReadAt, lookupAt]);

  // Load schedule and archive when active channel changes
  useEffect(() => {
    if (!open || !activeChannelId) return;
    let cancelled = false;
    // Opened again, or another channel: forget what was found before, unless a session runs on this video.
    if (!sessionHeld.current) { setLookupInfo(null); setLiveSwitch(null); }
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
        // An answer from YouTube data is the truth about this channel, "no live video" included; any other
        // answer (a fallback, a failure) says only that the check could not be made.
        const fromYouTube = data.ok === true && data.dataOrigin === 'youtube-api';
        const liveId = data.liveVideo?.videoId;
        setLookupInfo({ channelId: activeChannelId, videoId: fromYouTube && typeof liveId === 'string' && REAL_VIDEO_ID.test(liveId) ? liveId : '', authoritative: fromYouTube, at: Date.now(), embeddable: data.liveVideo?.embeddable !== false });
        setVideosOwner(activeChannelId);
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
        setLookupInfo({ channelId: activeChannelId, videoId: '', authoritative: false, at: Date.now() });
        setVideosOwner(activeChannelId);
        setVideos([]);
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
  }, [open, activeChannelId, lookupNonce]);

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

  // What the list says about who is live is a hint: believed while it is young and while this channel's own lookup
  // is out. A lookup answered from YouTube data is the truth for its channel, "none" included, and drops a "live"
  // the list gave. Under a running session the belief is frozen: the video is never changed under it.
  const lookupHere = lookupInfo && activeChannel && lookupInfo.channelId === activeChannel.id ? lookupInfo : null;
  const lookupAuth = lookupHere && lookupHere.authoritative ? lookupHere : null;
  const listFresh = listReadAt > 0 && Date.now() - listReadAt < LIST_MAX_AGE_MS;
  const lookupFresh = Boolean(lookupAuth) && Date.now() - lookupAuth.at < LIST_MAX_AGE_MS;
  // YouTube data about this channel, once it has answered, wins at once: a "live" the list gave is dropped if the
  // lookup names no live video or another one. Under a running session the finding is frozen (the video under it
  // is never changed).
  const computedContradicted = Boolean(activeChannel) && Boolean(lookupAuth) && lookupAuth.videoId !== activeChannel.defaultVideoId;
  const contradicted = sessionHeld.current ? contradictedRef.current : computedContradicted;
  if (!sessionHeld.current) contradictedRef.current = computedContradicted;
  // A live video the player refused (error 100, 101 or 150 once it was tried), or that YouTube data says may not be
  // embedded, is not played here; a player refusal is remembered for the life of the page. Under a running session
  // the refusals are frozen as they were: nothing changes the video under a session (the page says it stopped).
  const entryLiveId = activeChannel ? activeChannel.liveVideoId || (activeChannel.status === 'live' ? activeChannel.defaultVideoId || '' : '') : '';
  const computedRefused = new Map(refusedIds);
  if (lookupAuth?.embeddable === false && lookupAuth.videoId && !computedRefused.has(lookupAuth.videoId)) computedRefused.set(lookupAuth.videoId, { code: 150 });
  if (activeChannel?.embeddable === false && entryLiveId && !computedRefused.has(entryLiveId)) computedRefused.set(entryLiveId, { code: 150 });
  const refusedMap = sessionHeld.current ? refusedFrozen.current : computedRefused;
  if (!sessionHeld.current) refusedFrozen.current = computedRefused;
  const isRefused = (id) => Boolean(id) && refusedMap.has(id);
  // The channel's own video is live as far as is known: the list said so and nothing has contradicted it.
  const keepCurated = Boolean(activeChannel) && listLiveOf(activeChannel) && !contradicted && !isRefused(activeChannel.defaultVideoId);
  // The word LIVE needs an answer that is still young: the lookup's if it has answered, else the list's.
  const labelFresh = lookupAuth ? lookupFresh : listFresh;
  const liveSwitchedId = liveSwitch && liveSwitch.channelId === activeChannelId ? liveSwitch.videoId : '';
  const shownChannels = useMemo(
    () => channels.map((c) => {
      const live = c.id === activeChannelId && playbackMode === 'live' ? (Boolean(liveSwitchedId) || keepCurated) && labelFresh : willPlayLive(c, listFresh);
      return live === (c.status === 'live') ? c : { ...c, status: live ? 'live' : c.status === 'live' ? 'recent' : c.status };
    }),
    [channels, liveSwitchedId, activeChannelId, playbackMode, listFresh, keepCurated, labelFresh],
  );
  const filteredChannels = useMemo(() => {
    if (!selectedCategory || selectedCategory === 'ALL') return shownChannels;
    return shownChannels.filter((c) => c.category === selectedCategory);
  }, [shownChannels, selectedCategory]);

  // The video live mode plays: the switched-to live video when there is one, else the channel's written one. A
  // remembered live video the list confirmed (not a curated recording) is not played once YouTube data contradicts it
  // (age alone never stops it).
  const writtenEmbedUrl = activeChannel && !(activeChannel.hinted && contradicted) && !isRefused(embedVideoId(activeChannel.embedUrl)) ? activeChannel.embedUrl || '' : '';
  const liveEmbedUrl = liveSwitchedId
    ? `https://www.youtube-nocookie.com/embed/${liveSwitchedId}?autoplay=1&mute=1&playsinline=1`
    : writtenEmbedUrl;

  const selectedArchiveItem = useMemo(() => {
    return archive.find((a) => a.id === selectedBroadcastId) || archive[0] || null;
  }, [archive, selectedBroadcastId]);

  // My sessions names a pasted video's sessions (their channel id is the fixed LINK_CHANNEL_ID).
  const pastChannels = useMemo(() => [...channels, { id: LINK_CHANNEL_ID, name: 'YouTube link' }], [channels]);

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
    // On phones the field closes now; focus goes to the channel name so it is not dropped to the page body.
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
    if (writtenEmbedUrl && activeChannel?.defaultVideoId) {
      return `https://www.youtube.com/watch?v=${activeChannel.defaultVideoId}`;
    }
    return activeChannel?.channelUrl || 'https://www.youtube.com';
  }, [playbackMode, pasted, activeVideo, selectedArchiveItem, activeChannel, liveSwitchedId, writtenEmbedUrl]);

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

  // The key of the player on screen. Player information is stored with the key it arrived under and used only
  // while that is still the key, so a duration from the previous video is never taken for this one.
  const frameKey = embedFrameKey({ channelId: activeChannelId, broadcastId: selectedBroadcastId, mode: playbackMode, reloadKey })
    + (playbackMode === 'live' && liveSwitchedId ? `-${liveSwitchedId}` : '') + (linkId ? `-link-${linkId}` : '');
  const frameKeyRef = useRef(frameKey);
  frameKeyRef.current = frameKey;
  const player = useYoutubePlayer(open, {
    onMutedChange: (m) => { nextEmbedMuted.current = m; setIsMuted(m); },
    onFallback: () => setReloadKey((k) => k + 1),
    onInfo: (info) => setPlayerInfo({ ...info, frameKey: frameKeyRef.current }),
    onError: (code) => {
      setPlayerError(code);
      // A live-mode video the player will not show: remembered, so the page never goes back to it.
      const id = playingIdRef.current;
      if (isBlockingPlayerError(code) && modeRef.current === 'live' && id) {
        setRefusedIds((prev) => (prev.has(id) ? prev : new Map(prev).set(id, { code, channelId: channelIdRef.current })));
      }
    },
  });
  const applyMute = (next) => {
    nextEmbedMuted.current = next; // a fallback remount, or a later Play, mounts with this
    setIsMuted(next);
    player.requestMute(next);
  };

  // F344: fact-check. Added after the existing hooks; nothing above changed. What is playing is read
  // from the embed address, so it names the video that is really on screen.
  const factCheckVideoId = embedVideoId(currentEmbedUrl);
  playingIdRef.current = factCheckVideoId;
  channelIdRef.current = activeChannel?.id || '';
  modeRef.current = playbackMode;
  // A pasted video is live unless the player shows it is not (see pastedVideoKind); live sessions stay private.
  // Fixed when a session is confirmed and kept until it is over (idle, ended or error): player information that
  // arrives later cannot turn a private live session into a shared recorded one, or the other way round.
  if (kindLatch.current && !SESSION_OPEN.has(sessionStatusRef.current)) kindLatch.current = null;
  const latchedKind = kindLatch.current && kindLatch.current.linkId === linkId ? kindLatch.current.kind : null;
  const infoNow = playerInfo && playerInfo.frameKey === frameKey ? playerInfo : null;
  const linkLive = Boolean(linkId) && (latchedKind ?? pastedVideoKind(infoNow)) === 'live';
  const treatAsLive = playbackMode === 'live' || linkLive;
  const linkBlocked = Boolean(linkId) && isBlockingPlayerError(playerError); // no target: nothing to fact-check
  const factCheckChannelId = linkId ? LINK_CHANNEL_ID : activeChannel?.id || '';
  const factCheckTarget = linkBlocked ? null : playingTarget(factCheckChannelId, playbackMode, factCheckVideoId);
  const videoTitle = (linkId ? infoNow?.title : playbackMode === 'video' ? activeVideo?.title : playbackMode === 'archive' ? selectedArchiveItem?.title : '') || '';
  // Seconds left, only for a video the player has explicitly said is not live (pastedVideoKind's strict rule),
  // never in live mode, and only from the current player's own information.
  const remainingSeconds = playbackMode !== 'live' && !treatAsLive && pastedVideoKind(infoNow) === 'recorded'
    ? remainingSecondsOf({ durationS: infoNow.durationS, positionS: player.getPosition()?.positionS })
    : null;
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
        title: videoTitle,
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
  // The video wanted: the lookup's, once it has answered from YouTube data (none included); the list's only while
  // the lookup is out and the list is young.
  const liveCandidate = lookupAuth ? lookupAuth.videoId : listFresh ? activeChannel?.liveVideoId || '' : '';
  const liveWanted = activeChannel && switchableOf(activeChannel, keepCurated) && REAL_VIDEO_ID.test(liveCandidate) && !isRefused(liveCandidate) ? liveCandidate : '';
  useEffect(() => {
    // nothing changes the video under a running session, a refused one included (the page says it stopped)
    if (!activeChannel || heldBySession) return;
    if (liveSwitchedId === liveWanted) return;
    // a start screen the user opened is closed by the target change: it is opened again below
    if (sessionStatus === 'choosing' && playbackMode === 'live') reopenChoose.current = true;
    setLiveSwitch(liveWanted ? { channelId: activeChannel.id, videoId: liveWanted } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel, liveWanted, liveSwitchedId, heldBySession]);
  // A channel added without a curated video has nothing to play until its live video is found: "Connecting"
  // while the lookup is out, then the live video, or "No live stream found" with the latest upload if there is
  // one. Nothing is fact-checked while the card shows (no embed, so no target).
  // "Connecting" is whenever no answer in hand belongs to the selected channel (derived from the answer itself, not
  // from an effect that runs after the first paint), so a click never shows the previous channel's latest upload.
  const noVideoYet = playbackMode === 'live' && Boolean(activeChannel) && !liveEmbedUrl;
  const refusedLiveId = [liveCandidate, entryLiveId, lookupAuth?.videoId].find((id) => REAL_VIDEO_ID.test(id || '') && isRefused(id)) || '';
  const writtenRefused = Boolean(activeChannel) && isRefused(embedVideoId(activeChannel.embedUrl));
  const refusedCode = refusedMap.get(refusedLiveId || embedVideoId(activeChannel?.embedUrl))?.code || 150;
  // The video on screen was refused while a session ran on it: it stays, and the user is told.
  const stoppedPlaying = playbackMode === 'live' && heldBySession && computedRefused.has(factCheckVideoId);
  const channelCard = noVideoYet ? (refusedLiveId || writtenRefused ? 'refused' : !lookupHere || Boolean(liveWanted) ? 'connecting' : lookupAuth ? 'notlive' : 'unknown') : null;
  const latestUpload = lookupAuth && videosOwner === activeChannel?.id ? videos.find((v) => !v.isLive && !v.isUpcoming) || null : null;
  const nothingPlaying = Boolean(channelCard) || linkBlocked;
  useEffect(() => {
    if (channelCard !== 'connecting') { setConnectingLong(false); return undefined; }
    const timer = setTimeout(() => setConnectingLong(true), 8000);
    return () => clearTimeout(timer);
  }, [channelCard]);
  const followed = Boolean(activeChannel) && followIds.includes(activeChannel.id);
  // A user's retry (Reload feed, Try again, Reload): the refusals remembered for this channel's videos are let go and
  // the channel is asked about again; an answer that says a video may not be embedded marks it again.
  function retryChannel() {
    const id = activeChannel?.id;
    setRefusedIds((prev) => {
      const next = new Map(prev);
      for (const [vid, v] of prev) if (v.channelId === id) next.delete(vid);
      return next.size === prev.size ? prev : next;
    });
    setLookupNonce((n) => n + 1);
  }
  function toggleFollow() {
    if (!activeChannel) return;
    if (!followed && followIds.length >= FOLLOW_MAX) { setFollowNote(FOLLOW_FULL); return; }
    setFollowNote('');
    const next = toggleFollowing(followIds, activeChannel.id);
    setFollowIds(next);
    writeFollowing(browserStorage(), next);
  }
  // Another tab changed My list: take its version, so two tabs do not overwrite each other.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
    const onStorage = (e) => { if (!e || e.key === null || e.key === undefined || e.key === FOLLOW_KEY) setFollowIds(readFollowing(browserStorage())); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  // Ids that are no longer channels are only hidden (the bar shows the known ones): they stay stored, so a list is not
  // wiped by an older deployment that does not know a channel yet. They count toward the cap.
  // The panel beside the video is held inside the window by a height that depends on what sits above it: measured.
  const selectChannel = (ch) => {
    leaveLink();
    if (ch.id !== activeChannelId) {
      // a new selection decides afresh: forget what was decided for the channel left
      setLiveSwitch(null);
      setLookupInfo(null);
    }
    // a pick after the list turned old reads it again (the list is believed for ten minutes)
    if (!listReadAt || Date.now() - listReadAt >= LIST_MAX_AGE_MS) setChannelsNonce((n) => n + 1);
    setFollowNote('');
    setActiveChannelId(ch.id);
    setPlaybackMode('live');
    setActiveVideo(null);
    setStreamError(false);
    setReloadKey((k) => k + 1);
  };
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
    ...(factCheckOffered ? [['sessions', 'My sessions']] : []),
  ];
  // My sessions can stop being offered while it is the chosen tab: show Channel Videos then, so one tab stays
  // the tab stop and the panel is not empty.
  const shownTab = tabs.some(([id]) => id === activeTab) ? activeTab : 'videos';
  const linkTitle = infoNow?.title || 'YouTube video';
  const programTitle = linkId
    ? linkTitle
    : playbackMode === 'archive'
    ? selectedArchiveItem?.title || 'Archived Recording'
    : (playbackMode === 'video' && activeVideo?.title) || activeChannel?.name || '';

  // B4: paste a YouTube video or live link. It lives at the top of the fact-check panel (the panel is told to show
  // it), or above the player where fact-check is not offered. On phones the field opens from a button.
  const linkForm = (
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
  );

  return (
    <section className="ltv-page" aria-label="Live TV">
      {/* Page body: the channel card, the video and panel, then the lower tabs (liveTv.css). Below 1081px the page
          scrolls; from 1081px, when the window is tall enough, .ltv-body is a grid (video stage, now-playing row and lower
          area in the left column, the panel in the right) and only the lower area (.ltv-lower) scrolls. */}
      <div className="ltv-main">
      {/* F395: one wrapper, invisible (display: contents) except on laptop-height windows with the panel, where it is
          the grid that lets the panel start beside the channel bar (liveTv.css). */}
      <div className={`ltv-grid${factCheckOffered ? ' has-panel' : ''}`}>
      <div className="ltv-barwrap">
      {lists.length ? (
        <ChannelBar
          channels={shownChannels}
          lists={lists}
          activeChannelId={activeChannelId}
          playbackMode={playbackMode}
          loading={channelsLoading}
          following={followIds}
          onSelectChannel={selectChannel}
          onModalChange={setBarModal}
        />
      ) : (
        <ChannelCard
          channels={channels}
          visible={filteredChannels}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          activeChannelId={activeChannelId}
          playbackMode={playbackMode}
          loading={channelsLoading}
          onSelectChannel={selectChannel}
        />
      )}
      </div>

      {factCheckOffered ? null : <div className="ltv-linkbar" inert={barModal ? true : undefined}>{linkForm}</div>}

      <div className={`ltv-body${factCheckOffered ? ' has-panel' : ''}`} inert={barModal ? true : undefined}>
        <div className={`ltv-split${factCheckOffered ? ' has-panel' : ''}`}>
        <div className="ltv-videocol">
          {/* Player Stage */}
          <section className="ltv-player-stage">
          <div className="ltv-video-container" ref={playerContainerRef}>
            {channelCard === 'connecting' ? (
              <div className="ltv-offline-card" role="status">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" role="img" aria-label="Loading" className="ltv-connecting-icon"><path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" /></svg>
                <p className="ltv-connecting-line">Connecting to {activeChannel?.name}…</p>
                {connectingLong ? (
                  <button type="button" className="ltv-action-btn primary" onClick={retryChannel}>Reload feed</button>
                ) : null}
              </div>
            ) : channelCard === 'refused' ? (
              <div className="ltv-offline-card" role="alert">
                <h4>Can't play this video here</h4>
                <p>{playerErrorMessage(refusedCode)}</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                  <a href={refusedLiveId ? `https://www.youtube.com/watch?v=${refusedLiveId}` : externalWatchUrl} target="_blank" rel="noopener noreferrer" className="ltv-action-btn primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    Open on YouTube ↗
                  </a>
                </div>
              </div>
            ) : channelCard === 'unknown' ? (
              <div className="ltv-offline-card" role="status">
                <h4>Couldn't check {activeChannel?.name} right now</h4>
                <p>We could not find out whether it is on air. You can open it on YouTube or try again.</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                  <a href={externalWatchUrl} target="_blank" rel="noopener noreferrer" className="ltv-action-btn primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    Open on YouTube ↗
                  </a>
                  <button type="button" className="ltv-action-btn" onClick={retryChannel}>Try again</button>
                </div>
              </div>
            ) : channelCard === 'notlive' ? (
              <div className="ltv-offline-card" role="status">
                <h4>No live stream found for {activeChannel?.name}</h4>
                {latestUpload ? (
                  <p>Latest upload: “{latestUpload.title}”{latestUpload.duration ? ` · ${latestUpload.duration}` : ''}</p>
                ) : (
                  <p>There is no video to play here right now.</p>
                )}
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                  {latestUpload ? (
                    <button type="button" className="ltv-action-btn primary" onClick={() => handlePlayVideo(latestUpload)}>Play latest video</button>
                  ) : null}
                  <a href={externalWatchUrl} target="_blank" rel="noopener noreferrer" className="ltv-action-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    Open on YouTube ↗
                  </a>
                  {latestUpload ? null : (
                    <button type="button" className="ltv-action-btn" onClick={retryChannel}>Reload</button>
                  )}
                </div>
              </div>
            ) : streamError || !embedSrc ? (
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
                key={frameKey}
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
              <h3 tabIndex={-1} ref={titleRef}>{programTitle}</h3>
              <div className="ltv-np-badges">
              {playbackMode === 'live' ? (
                streamError ? (
                  <span className="ltv-offline-badge">
                    <span className="ltv-offline-dot" /> OFFLINE
                  </span>
                ) : channelCard ? (
                  <span className="ltv-recent-badge">
                    <span className="ltv-recent-dot" /> {channelCard === 'connecting' ? 'CONNECTING' : channelCard === 'unknown' ? "CAN'T CHECK" : channelCard === 'refused' ? "CAN'T PLAY HERE" : 'NO LIVE STREAM FOUND'}
                  </span>
                ) : (liveSwitchedId || keepCurated) && labelFresh ? (
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
              <p className="ltv-np-line">
                {linkId ? (
                  ['YouTube link', infoNow?.isLive === true ? 'Live' : pastedVideoKind(infoNow) === 'recorded' ? 'Video' : ''].filter(Boolean).join(' · ')
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
              {playbackMode === 'live' && refusedLiveId && liveEmbedUrl ? (
                <p className="ltv-refused-note" role="status">
                  {activeChannel?.name}'s live stream can't be played here.{' '}
                  <a href={`https://www.youtube.com/watch?v=${refusedLiveId}`} target="_blank" rel="noopener noreferrer">Open on YouTube</a>
                </p>
              ) : null}
              {followNote ? <p className="ltv-follow-note" role="status">{followNote}</p> : null}
              {stoppedPlaying ? <p className="ltv-stopped-note" role="status">This video stopped playing here. End the fact-check to get unused minutes back.</p> : null}
              {(linkId || playbackMode === 'live') && playerError !== null && !isBlockingPlayerError(playerError) ? (
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
              {!linkId && activeChannel ? (
                <button type="button" className="ltv-action-btn" aria-label={`Follow ${activeChannel.name}`} aria-pressed={followed} onClick={toggleFollow} title={followed ? 'Remove from My list' : 'Add to My list'}>
                  {followed ? 'Following' : 'Follow'}
                </button>
              ) : null}
              {!linkId && activeChannel?.deskId && TAB_IDS.has(activeChannel.deskId) && (
                <button
                  type="button"
                  className="ltv-action-btn primary"
                  onClick={() => handleOpenDesk(activeChannel.deskId)}
                  title={`Open mapped ${activeChannel.deskId} desk`}
                >
                  Open Desk: {activeChannel.deskId}
                </button>
              )}
              {nothingPlaying ? null : (
              <>
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
              </>
              )}
              <button
                type="button"
                className="ltv-action-btn"
                onClick={() => { setPlayerError(null); setReloadKey((k) => k + 1); if (playbackMode === 'live' && (refusedLiveId || channelCard)) retryChannel(); }}
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
              channelName={linkId ? (infoNow?.title ? `“${infoNow.title}”` : 'this video') : activeChannel?.name || ''}
              playable={playable}
              pasted={Boolean(linkId)}
              loadingChannels={channelsLoading}
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
              videoTitle={videoTitle}
              remainingSeconds={remainingSeconds}
              linkForm={linkForm}
            />
          </div>
        ) : null}
        </div>

        {/* Lower Section Tabs: the lower area, the one scroll container from 1081px (liveTv.css) */}
        <div className="ltv-lower">
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

          {/* F360/F366: the user's finished fact-check sessions are the "My sessions" tab. The section stays
              mounted (hidden) while another tab shows, as it was always mounted below the page, so it loads and
              reloads as before and an open delete question is not lost on a tab change. */}
          <div hidden={!factCheckOffered || shownTab !== 'sessions'}>
            <PastSessions userId={factCheck.view?.flag?.userId} enabled={factCheckOffered} sessionStatus={factCheck.view?.session?.status} channels={pastChannels} />
          </div>
        </div>
        </div>
      </div>
      </div>
      </div>
    </section>
  );
}
