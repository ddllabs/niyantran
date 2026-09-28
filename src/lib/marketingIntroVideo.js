/**
 * Client helpers for the marketing homepage intro video.
 * Reads are public. Admin calls send a verified internal-admin bearer; the
 * video itself goes straight to Supabase Storage through a signed upload URL.
 */
import { supabase } from './supabaseClient.js';
import { verifiedLocalIdentity } from './userStore.js';

const API = '/api/marketing/intro-video';

async function adminHeaders(extra = {}) {
  const identity = await verifiedLocalIdentity({ admin: true });
  if (!identity) throw new Error('Internal admin sign-in required');
  return { ...extra, Authorization: `Bearer ${identity.token}` };
}

async function adminJson(path, method, payload, failure) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: await adminHeaders(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error || `${failure} (${res.status})`);
  return body;
}

const EVENT = 'niy-marketing-intro-video';

export function emptyIntroVideo() {
  return {
    ok: true,
    enabled: true,
    title: 'What nter.pro is',
    subtitle: 'A short walkthrough for visitors deciding whether to sign in.',
    videoUrl: '',
    externalUrl: '',
    posterUrl: '',
    fileName: '',
    updatedAt: '',
    bytes: 0,
    hasVideo: false,
  };
}

export async function fetchIntroVideo(signal) {
  try {
    const res = await fetch(API, { signal });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) return emptyIntroVideo();
    return { ...emptyIntroVideo(), ...body };
  } catch {
    return emptyIntroVideo();
  }
}

export async function saveIntroVideoMeta(patch) {
  const body = await adminJson('', 'PUT', patch, 'Save failed');
  window.dispatchEvent(new Event(EVENT));
  return body;
}

const TYPES_BY_EXTENSION = { webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime' };

function typeFromName(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  return TYPES_BY_EXTENSION[ext] || 'video/mp4';
}

/**
 * Two steps: the server signs an upload URL for its fixed object path, the
 * browser uploads straight to Storage, then the server records the metadata.
 * Progress is reported per step (signed, uploaded, saved), not per byte:
 * the Storage client's upload has no byte-progress callback.
 */
export async function uploadIntroVideo(file, onProgress) {
  if (!file) throw new Error('Choose a video file first.');
  const contentType = file.type || typeFromName(file.name);
  onProgress?.(0);
  const signed = await adminJson('/upload-url', 'POST', { contentType, bytes: file.size, fileName: file.name || '' }, 'Upload failed');
  onProgress?.(10);
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType, upsert: true });
  if (error) throw new Error(error.message || 'Upload to storage failed');
  onProgress?.(90);
  const body = await adminJson('/finalize', 'POST', { path: signed.path }, 'Upload failed');
  onProgress?.(100);
  window.dispatchEvent(new Event(EVENT));
  return body;
}

export async function clearIntroVideo() {
  const body = await adminJson('', 'DELETE', undefined, 'Clear failed');
  window.dispatchEvent(new Event(EVENT));
  return body;
}

export function subscribeIntroVideo(fn) {
  const on = () => fn();
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}

/** Turn a YouTube/Vimeo/mp4 URL into an embeddable form. */
export function videoPlayback(meta) {
  const external = String(meta?.externalUrl || '').trim();
  const file = String(meta?.videoUrl || '').trim();
  if (file) {
    return { kind: 'file', src: file, poster: meta?.posterUrl || '' };
  }
  if (!external) return { kind: 'none' };

  const yt =
    external.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/) ||
    external.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/);
  if (yt) {
    return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0` };
  }
  const vim = external.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vim) {
    return { kind: 'iframe', src: `https://player.vimeo.com/video/${vim[1]}` };
  }
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(external) || /^https?:\/\//i.test(external)) {
    return { kind: 'file', src: external, poster: meta?.posterUrl || '' };
  }
  return { kind: 'iframe', src: external };
}
