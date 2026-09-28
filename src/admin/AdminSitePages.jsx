import { useEffect, useMemo, useState } from 'react';
import { loadPrivacy, newPrivacySection, resetPrivacy, savePrivacy } from '../lib/privacyStore.js';
import { loadSiteSettings, resetSiteSettings, saveSiteSettings } from '../lib/siteSettingsStore.js';
import { loadTerms, newTermsSection, resetTerms, saveTerms } from '../lib/termsStore.js';
import {
  clearIntroVideo,
  emptyIntroVideo,
  fetchIntroVideo,
  saveIntroVideoMeta,
  uploadIntroVideo,
} from '../lib/marketingIntroVideo.js';

const SETTING_TABS = [
  { id: 'identity', label: 'Identity' },
  { id: 'seo', label: 'SEO & social' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'homepage', label: 'Homepage video' },
];

export function SiteSettingsPage() {
  const [form, setForm] = useState(() => loadSiteSettings());
  const [tab, setTab] = useState('identity');
  const [msg, setMsg] = useState('');
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

  function patch(key, value) {
    setForm((s) => ({ ...s, [key]: value }));
    setMsg('');
  }

  function patchVideo(key, value) {
    setVideo((s) => ({ ...s, [key]: value }));
    setVMsg('');
  }

  function onSave(e) {
    e.preventDefault();
    saveSiteSettings(form);
    setMsg('Website settings published. Meta tags and scripts update immediately.');
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
      <p className="adm-lede">
        Name, description, search metadata, measurement scripts, and the public homepage walkthrough video.
      </p>
      <div className="adm-filters">
        {SETTING_TABS.map((t) => (
          <button key={t.id} type="button" className={`adm-chip${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab !== 'homepage' ? (
        <form onSubmit={onSave}>
          {tab === 'identity' ? (
            <div className="adm-card">
              <h2>Identity</h2>
              <div className="adm-form">
                <label className="adm-field">
                  <span>Website name</span>
                  <input value={form.siteName} onChange={(e) => patch('siteName', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Short name</span>
                  <input value={form.shortName} onChange={(e) => patch('shortName', e.target.value)} />
                </label>
                <label className="adm-field span2">
                  <span>Tagline</span>
                  <input value={form.tagline} onChange={(e) => patch('tagline', e.target.value)} />
                </label>
                <label className="adm-field span2">
                  <span>Description</span>
                  <textarea value={form.description} onChange={(e) => patch('description', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Contact email</span>
                  <input type="email" value={form.contactEmail} onChange={(e) => patch('contactEmail', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Public website URL</span>
                  <input
                    placeholder="https://"
                    value={form.contactWebsite}
                    onChange={(e) => patch('contactWebsite', e.target.value)}
                  />
                </label>
                <label className="adm-field span2">
                  <span>Registered address</span>
                  <input value={form.contactAddress} onChange={(e) => patch('contactAddress', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Theme colour</span>
                  <input value={form.themeColor} onChange={(e) => patch('themeColor', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Favicon URL</span>
                  <input value={form.faviconUrl} onChange={(e) => patch('faviconUrl', e.target.value)} />
                </label>
              </div>
            </div>
          ) : null}

          {tab === 'seo' ? (
            <div className="adm-card">
              <h2>Search and social</h2>
              <div className="adm-form">
                <label className="adm-field span2">
                  <span>Meta title</span>
                  <input value={form.metaTitle} onChange={(e) => patch('metaTitle', e.target.value)} />
                </label>
                <label className="adm-field span2">
                  <span>Meta description</span>
                  <textarea value={form.metaDescription} onChange={(e) => patch('metaDescription', e.target.value)} />
                </label>
                <label className="adm-field span2">
                  <span>Meta keywords</span>
                  <input value={form.metaKeywords} onChange={(e) => patch('metaKeywords', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Canonical URL</span>
                  <input placeholder="https://…" value={form.canonicalUrl} onChange={(e) => patch('canonicalUrl', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Robots</span>
                  <select value={form.robots} onChange={(e) => patch('robots', e.target.value)}>
                    <option value="index,follow">index, follow</option>
                    <option value="noindex,follow">noindex, follow</option>
                    <option value="index,nofollow">index, nofollow</option>
                    <option value="noindex,nofollow">noindex, nofollow</option>
                  </select>
                </label>
                <label className="adm-field">
                  <span>Locale</span>
                  <input value={form.locale} onChange={(e) => patch('locale', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Author</span>
                  <input value={form.author} onChange={(e) => patch('author', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Open Graph title</span>
                  <input placeholder="Defaults to meta title" value={form.ogTitle} onChange={(e) => patch('ogTitle', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Open Graph image</span>
                  <input value={form.ogImage} onChange={(e) => patch('ogImage', e.target.value)} />
                </label>
                <label className="adm-field span2">
                  <span>Open Graph description</span>
                  <input
                    placeholder="Defaults to meta description"
                    value={form.ogDescription}
                    onChange={(e) => patch('ogDescription', e.target.value)}
                  />
                </label>
                <label className="adm-field">
                  <span>Twitter card</span>
                  <select value={form.twitterCard} onChange={(e) => patch('twitterCard', e.target.value)}>
                    <option value="summary_large_image">summary_large_image</option>
                    <option value="summary">summary</option>
                  </select>
                </label>
                <label className="adm-field">
                  <span>Twitter handle</span>
                  <input placeholder="@handle" value={form.twitterHandle} onChange={(e) => patch('twitterHandle', e.target.value)} />
                </label>
              </div>
            </div>
          ) : null}

          {tab === 'analytics' ? (
            <div className="adm-card">
              <h2>Measurement</h2>
              <div className="adm-form">
                <label className="adm-field">
                  <span>Google Analytics ID</span>
                  <input
                    placeholder="G-XXXXXXXXXX"
                    value={form.googleAnalyticsId}
                    onChange={(e) => patch('googleAnalyticsId', e.target.value.trim())}
                  />
                </label>
                <label className="adm-field">
                  <span>Google Tag Manager ID</span>
                  <input
                    placeholder="GTM-XXXXXXX"
                    value={form.googleTagManagerId}
                    onChange={(e) => patch('googleTagManagerId', e.target.value.trim())}
                  />
                </label>
                <label className="adm-field span2">
                  <span>Additional head script / tags</span>
                  <textarea
                    className="adm-code"
                    placeholder={'<script async src="https://www.googletagmanager.com/gtag/js?id=G-…"></script>'}
                    value={form.customHeadHtml}
                    onChange={(e) => patch('customHeadHtml', e.target.value)}
                  />
                </label>
              </div>
              <p className="adm-hint">
                A Measurement ID injects the official gtag snippet. Paste extra <code>&lt;script&gt;</code>,{' '}
                <code>&lt;meta&gt;</code> or <code>&lt;link&gt;</code> tags only from an operator you trust — they
                run in every visitor’s browser.
              </p>
            </div>
          ) : null}

          <div className="adm-actions">
            <button className="adm-btn" type="submit">
              Publish settings
            </button>
            <button
              className="adm-btn ghost"
              type="button"
              onClick={() => {
                setForm(resetSiteSettings());
                setMsg('Restored default website settings.');
              }}
            >
              Restore defaults
            </button>
            {msg ? <span className="adm-msg">{msg}</span> : null}
          </div>
        </form>
      ) : (
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
                />
                <span>Show video section on the homepage</span>
              </label>
              <label className="adm-field span2">
                <span>Section title</span>
                <input value={video.title || ''} onChange={(e) => patchVideo('title', e.target.value)} />
              </label>
              <label className="adm-field span2">
                <span>Supporting line</span>
                <input value={video.subtitle || ''} onChange={(e) => patchVideo('subtitle', e.target.value)} />
              </label>
              <label className="adm-field span2">
                <span>Upload video file</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogg,.mov"
                  disabled={vBusy}
                  onChange={(e) => onUpload(e.target.files?.[0])}
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
                />
              </label>
              <label className="adm-field span2">
                <span>Poster image URL (optional)</span>
                <input
                  placeholder="/brand/… or https://…"
                  value={video.posterUrl || ''}
                  onChange={(e) => patchVideo('posterUrl', e.target.value)}
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
      )}
    </>
  );
}

export function PrivacyAdminPage() {
  return (
    <LegalDocAdmin
      title="Privacy policy"
      lede="This is the copy on the public Privacy Policy page. Use ### Heading for subsections and - item for lists."
      emailLabel="Privacy email"
      load={loadPrivacy}
      save={savePrivacy}
      reset={resetPrivacy}
      newSection={newPrivacySection}
      viewHref="/privacy"
      published="Privacy policy published to the public page."
    />
  );
}

export function TermsAdminPage() {
  return (
    <LegalDocAdmin
      title="Terms & conditions"
      lede="This is the copy on the public Terms page. Use ### Heading for subsections and - item for lists. Markdown links such as [Privacy Policy](/privacy) become live links."
      emailLabel="Legal email"
      load={loadTerms}
      save={saveTerms}
      reset={resetTerms}
      newSection={newTermsSection}
      viewHref="/terms"
      published="Terms published to the public page."
      extraFields
    />
  );
}

function LegalDocAdmin({
  title,
  lede,
  emailLabel,
  load,
  save,
  reset,
  newSection,
  viewHref,
  published,
  extraFields,
}) {
  const [doc, setDoc] = useState(() => load());
  const [open, setOpen] = useState(() => doc.sections[0]?.id || '');
  const [msg, setMsg] = useState('');
  const count = useMemo(() => (doc.sections || []).length, [doc]);

  function patchMeta(key, value) {
    setDoc((d) => ({ ...d, [key]: value }));
    setMsg('');
  }

  function patchSection(id, field, value) {
    setDoc((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    }));
    setMsg('');
  }

  function move(id, dir) {
    setDoc((d) => {
      const list = [...d.sections];
      const i = list.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, sections: list.map((s, n) => ({ ...s, num: String(n + 1) })) };
    });
    setMsg('');
  }

  function removeSection(id) {
    setDoc((d) => {
      const sections = d.sections.filter((s) => s.id !== id).map((s, n) => ({ ...s, num: String(n + 1) }));
      return { ...d, sections };
    });
    setMsg('');
  }

  function addSection() {
    const next = newSection(doc.sections.length);
    setDoc((d) => ({ ...d, sections: [...d.sections, next] }));
    setOpen(next.id);
    setMsg('');
  }

  function onSave(e) {
    e.preventDefault();
    save(doc);
    setMsg(published);
  }

  return (
    <>
      <h1 className="adm-h1">{title}</h1>
      <p className="adm-lede">{lede}</p>
      <form onSubmit={onSave}>
        <div className="adm-card">
          <h2>Document</h2>
          <div className="adm-form">
            <label className="adm-field">
              <span>Last updated</span>
              <input value={doc.lastUpdated} onChange={(e) => patchMeta('lastUpdated', e.target.value)} />
            </label>
            <label className="adm-field">
              <span>Organisation</span>
              <input value={doc.org} onChange={(e) => patchMeta('org', e.target.value)} />
            </label>
            <label className="adm-field">
              <span>Team</span>
              <input value={doc.team} onChange={(e) => patchMeta('team', e.target.value)} />
            </label>
            <label className="adm-field">
              <span>{emailLabel}</span>
              <input type="email" value={doc.email} onChange={(e) => patchMeta('email', e.target.value)} />
            </label>
            <label className="adm-field">
              <span>Website</span>
              <input placeholder="Leave blank to use site URL" value={doc.website} onChange={(e) => patchMeta('website', e.target.value)} />
            </label>
            <label className="adm-field">
              <span>Address</span>
              <input value={doc.address} onChange={(e) => patchMeta('address', e.target.value)} />
            </label>
            {extraFields ? (
              <>
                <label className="adm-field">
                  <span>Governing law</span>
                  <input
                    placeholder="e.g. India"
                    value={doc.jurisdiction || ''}
                    onChange={(e) => patchMeta('jurisdiction', e.target.value)}
                  />
                </label>
                <label className="adm-field">
                  <span>Courts / forum</span>
                  <input
                    placeholder="e.g. courts of Mumbai"
                    value={doc.courts || ''}
                    onChange={(e) => patchMeta('courts', e.target.value)}
                  />
                </label>
              </>
            ) : null}
          </div>
        </div>

        {doc.sections.map((s, i) => (
          <article key={s.id} className={`adm-card adm-sec${open === s.id ? ' open' : ''}`}>
            <button type="button" className="adm-sec-h" onClick={() => setOpen(open === s.id ? '' : s.id)}>
              <em>{s.num}</em>
              <strong>{s.title || 'Untitled'}</strong>
              <span>{open === s.id ? 'Collapse' : 'Edit'}</span>
            </button>
            {open === s.id ? (
              <div className="adm-form" style={{ marginTop: 12 }}>
                <label className="adm-field">
                  <span>Number</span>
                  <input value={s.num} onChange={(e) => patchSection(s.id, 'num', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Title</span>
                  <input value={s.title} onChange={(e) => patchSection(s.id, 'title', e.target.value)} />
                </label>
                <label className="adm-field span2">
                  <span>Body</span>
                  <textarea
                    className="adm-policy-body"
                    value={s.body}
                    onChange={(e) => patchSection(s.id, 'body', e.target.value)}
                  />
                </label>
                <div className="adm-actions span2">
                  <button className="adm-btn ghost" type="button" disabled={i === 0} onClick={() => move(s.id, -1)}>
                    Move up
                  </button>
                  <button
                    className="adm-btn ghost"
                    type="button"
                    disabled={i === count - 1}
                    onClick={() => move(s.id, 1)}
                  >
                    Move down
                  </button>
                  <button className="adm-btn danger" type="button" onClick={() => removeSection(s.id)}>
                    Remove section
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        ))}

        <div className="adm-actions">
          <button className="adm-btn" type="submit">
            Publish
          </button>
          <button className="adm-btn ghost" type="button" onClick={addSection}>
            Add section
          </button>
          <a className="adm-btn ghost" href={viewHref} target="_blank" rel="noreferrer">
            View public page
          </a>
          <button
            className="adm-btn ghost"
            type="button"
            onClick={() => {
              const next = reset();
              setDoc(next);
              setOpen(next.sections[0]?.id || '');
              setMsg('Restored the original text.');
            }}
          >
            Restore original
          </button>
          {msg ? <span className="adm-msg">{msg}</span> : null}
        </div>
      </form>
    </>
  );
}
