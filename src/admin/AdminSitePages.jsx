import { useEffect, useState } from 'react';
import {
  clearIntroVideo,
  emptyIntroVideo,
  fetchIntroVideo,
  saveIntroVideoMeta,
  uploadIntroVideo,
} from '../lib/marketingIntroVideo.js';

export function SiteSettingsPage() {
  const [video, setVideo] = useState(() => emptyIntroVideo());
  const [vBusy, setVBusy] = useState(false);
  const [vMsg, setVMsg] = useState('');
  const [vProgress, setVProgress] = useState(0);
  const [fileLabel, setFileLabel] = useState('');

  useEffect(() => {
    let alive = true;
    fetchIntroVideo().then((meta) => {
      if (alive) setVideo(meta);
    });
    return () => {
      alive = false;
    };
  }, []);

  function patchVideo(key, value) {
    setVideo((s) => ({ ...s, [key]: value }));
    setVMsg('');
  }

  async function onSaveVideo(e) {
    e.preventDefault();
    setVBusy(true);
    setVMsg('');
    try {
      const next = await saveIntroVideoMeta({
        enabled: video.enabled !== false,
        title: video.title,
        subtitle: video.subtitle,
        externalUrl: video.externalUrl,
        posterUrl: video.posterUrl,
      });
      setVideo(next);
      setVMsg('Homepage video settings saved. The public homepage picks them up on the next load.');
    } catch (err) {
      setVMsg(err.message || String(err));
    } finally {
      setVBusy(false);
    }
  }

  async function onUpload(file) {
    if (!file) return;
    setFileLabel(file.name);
    setVBusy(true);
    setVProgress(0);
    setVMsg('');
    try {
      const next = await uploadIntroVideo(file, setVProgress);
      setVideo(next);
      setVMsg(`Uploaded ${file.name} (${Math.round((next.bytes || 0) / (1024 * 1024))} MB).`);
    } catch (err) {
      setVMsg(err.message || String(err));
    } finally {
      setVBusy(false);
      setVProgress(0);
    }
  }

  async function onClearVideo() {
    if (!window.confirm('Remove the uploaded homepage video?')) return;
    setVBusy(true);
    setVMsg('');
    try {
      const next = await clearIntroVideo();
      setVideo(next);
      setFileLabel('');
      setVMsg('Uploaded video cleared.');
    } catch (err) {
      setVMsg(err.message || String(err));
    } finally {
      setVBusy(false);
    }
  }

  return (
    <>
      <h1 className="adm-h1">Website settings</h1>
      <p className="adm-lede">The public homepage walkthrough video.</p>
      <p className="adm-hint">
        The website name, contact details, search tags and analytics IDs are published with the website itself, so
        every visitor sees the same values. They are changed with a website release, not on this page.
      </p>
      <form onSubmit={onSaveVideo}>
        <div className="adm-card">
          <h2>Homepage walkthrough video</h2>
          <p className="adm-hint" style={{ marginTop: 0 }}>
            This replaces the first-scroll Bill Passage preview on the public homepage. Upload an mp4/webm (up to
            50&nbsp;MB) or paste a YouTube / Vimeo / direct video URL. Uploaded files win when both are set.
          </p>
          <div className="adm-form">
            <label className="adm-field span2" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                checked={video.enabled !== false}
                onChange={(e) => patchVideo('enabled', e.target.checked)}
                name="video-enabled"
              />
              <span>Show video section on the homepage</span>
            </label>
            <label className="adm-field span2">
              <span>Section title</span>
              <input value={video.title || ''} onChange={(e) => patchVideo('title', e.target.value)} name="video-title" />
            </label>
            <label className="adm-field span2">
              <span>Supporting line</span>
              <input value={video.subtitle || ''} onChange={(e) => patchVideo('subtitle', e.target.value)} name="video-subtitle" />
            </label>
            <label className="adm-field span2">
              <span>Upload video file</span>
              <input
                type="file"
                accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogg,.mov"
                disabled={vBusy}
                onChange={(e) => onUpload(e.target.files?.[0])}
                name="video-file"
              />
            </label>
            {vProgress > 0 && vProgress < 100 ? (
              <p className="adm-hint span2">Uploading… {vProgress}%</p>
            ) : null}
            {video.videoUrl ? (
              <p className="adm-hint span2">
                Current file: <code>{video.fileName || 'intro-video'}</code>
                {video.bytes ? ` · ${Math.round(video.bytes / (1024 * 1024))} MB` : ''}
                {video.updatedAt ? ` · updated ${String(video.updatedAt).replace('T', ' ').slice(0, 16)}` : ''}
                {fileLabel ? ` · last picked ${fileLabel}` : ''}
              </p>
            ) : (
              <p className="adm-hint span2">No file uploaded yet. The homepage shows a placeholder until you add one.</p>
            )}
            <label className="adm-field span2">
              <span>Or external URL (YouTube / Vimeo / mp4)</span>
              <input
                placeholder="https://…"
                value={video.externalUrl || ''}
                onChange={(e) => patchVideo('externalUrl', e.target.value)}
                name="video-url"
              />
            </label>
            <label className="adm-field span2">
              <span>Poster image URL (optional)</span>
              <input
                placeholder="/brand/… or https://…"
                value={video.posterUrl || ''}
                onChange={(e) => patchVideo('posterUrl', e.target.value)}
                name="video-poster"
              />
            </label>
          </div>
          {video.videoUrl ? (
            <div className="adm-video-preview">
              <video src={video.videoUrl} controls playsInline preload="metadata" />
            </div>
          ) : null}
        </div>
        <div className="adm-actions">
          <button className="adm-btn" type="submit" disabled={vBusy}>
            Save video settings
          </button>
          <button className="adm-btn ghost" type="button" disabled={vBusy || !video.videoUrl} onClick={onClearVideo}>
            Remove uploaded file
          </button>
          <a className="adm-btn ghost" href="/#/" target="_blank" rel="noreferrer">
            View homepage
          </a>
          {vMsg ? <span className="adm-msg">{vMsg}</span> : null}
        </div>
      </form>
    </>
  );
}
