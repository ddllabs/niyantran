#!/usr/bin/env node
/**
 * Maintainer tool (F381): refreshes the live-video hints in server/liveTvChannels.mjs.
 *
 * A hint (`liveHintVideoId`) is the live video a channel had when it was added; it goes stale when the channel
 * starts a new stream. This script looks up every hinted channel's live video with the server's own lookup
 * (same steps, same unit budget) and, with --write, replaces a hint whose channel is live under another video.
 *
 *   YOUTUBE_API_KEY=... node scripts/refresh-livetv-hints.mjs            dry run: prints what would change
 *   YOUTUBE_API_KEY=... node scripts/refresh-livetv-hints.mjs --write    rewrites the hints in the channel file
 *   --only id1,id2                                                      restrict to some channels
 *
 * Run by a person only: it is not part of CI or the build, and it costs roughly 2 to 5 YouTube units per
 * channel (about 150 to 250 for the whole list). The key is read from the environment and never printed.
 * A hint is changed only on a complete answer from YouTube that names a live, embeddable video; a channel that is
 * not live now, or whose lookup failed, keeps its hint.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ID11 = /^[a-zA-Z0-9_-]{11}$/;
export const CHANNELS_FILE = fileURLToPath(new URL('../server/liveTvChannels.mjs', import.meta.url));

/**
 * Looks each hinted channel up and sorts the outcome. `lookup(channel)` returns the server's per-channel answer
 * (see fetchYouTubeChannelVideos) and may throw. Returns [{ id, old, status, next?, detail? }] where status is
 * 'same', 'changed', 'not-live', 'not-embeddable' or 'unknown'.
 */
export async function planHintRefresh(channels, lookup) {
  const results = [];
  for (const c of channels) {
    if (!ID11.test(c.liveHintVideoId || '')) continue;
    const entry = { id: c.id, old: c.liveHintVideoId };
    let answer;
    try {
      answer = await lookup(c);
    } catch (err) {
      results.push({ ...entry, status: 'unknown', detail: String(err?.kind || err?.name || 'error') });
      continue;
    }
    if (!answer || answer.ok === false || answer.dataOrigin !== 'youtube-api') {
      results.push({ ...entry, status: 'unknown', detail: String(answer?.reason || 'no complete answer') });
    } else if (!answer.liveVideo?.videoId) {
      results.push({ ...entry, status: 'not-live' });
    } else if (answer.liveVideo.videoId === c.liveHintVideoId) {
      results.push({ ...entry, status: 'same' });
    } else if (!ID11.test(answer.liveVideo.videoId)) {
      results.push({ ...entry, status: 'unknown', detail: 'unreadable video id' });
    } else if (answer.liveVideo.embeddable === false) {
      results.push({ ...entry, status: 'not-embeddable', next: answer.liveVideo.videoId });
    } else {
      results.push({ ...entry, status: 'changed', next: answer.liveVideo.videoId });
    }
  }
  return results;
}

/** The channel file's text with the 'changed' hints replaced. Throws if a channel's line cannot be found exactly once. */
export function applyHintUpdates(source, results) {
  const lines = source.split('\n');
  for (const r of results.filter((x) => x.status === 'changed')) {
    const start = `{ id: '${r.id}',`;
    const at = lines.reduce((acc, l, i) => (l.trimStart().startsWith(start) ? [...acc, i] : acc), []);
    if (at.length !== 1) throw new Error(`channel ${r.id}: expected one line, found ${at.length}`);
    const from = `liveHintVideoId: '${r.old}'`;
    if (lines[at[0]].split(from).length !== 2) throw new Error(`channel ${r.id}: hint ${r.old} not found exactly once`);
    lines[at[0]] = lines[at[0]].replace(from, `liveHintVideoId: '${r.next}'`);
  }
  return lines.join('\n');
}

export function summarize(results) {
  const by = (s) => results.filter((r) => r.status === s);
  const out = [`${results.length} hinted channels checked`];
  for (const s of ['changed', 'same', 'not-live', 'not-embeddable', 'unknown']) out.push(`  ${s}: ${by(s).length}`);
  for (const r of by('changed')) out.push(`  ~ ${r.id}: ${r.old} -> ${r.next}`);
  for (const r of by('not-embeddable')) out.push(`  ! ${r.id}: live as ${r.next} but not embeddable; hint kept`);
  for (const r of by('unknown')) out.push(`  ? ${r.id}: ${r.detail}; hint kept`);
  return out.join('\n');
}

export async function main({ argv = process.argv.slice(2), env = process.env, lookup, log = console.log, file = CHANNELS_FILE } = {}) {
  const write = argv.includes('--write');
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? String(argv[onlyAt + 1] || '').split(',').filter(Boolean) : null;
  if (!lookup && !env.YOUTUBE_API_KEY) {
    log('YOUTUBE_API_KEY is not set; nothing was looked up.');
    return 1;
  }
  const api = await import('../server/liveTvApi.mjs');
  const find = lookup || api.fetchYouTubeChannelVideos;
  const channels = api.YOUTUBE_SOURCES;
  const chosen = only ? channels.filter((c) => only.includes(c.id)) : channels;
  const results = await planHintRefresh(chosen, find);
  log(summarize(results));
  const changed = results.filter((r) => r.status === 'changed');
  if (!write) {
    log(changed.length ? 'Dry run: nothing written. Add --write to apply.' : 'Dry run: nothing to change.');
    return 0;
  }
  if (!changed.length) { log('Nothing to write.'); return 0; }
  writeFileSync(file, applyHintUpdates(readFileSync(file, 'utf8'), results));
  log(`Wrote ${changed.length} hint(s) to the channel file. Review the diff before committing.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, () => { console.error('Hint refresh failed.'); process.exitCode = 1; });
}
