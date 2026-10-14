import { useEffect, useMemo, useState } from 'react';
import { parsePolicyBody } from '../lib/policyBody.js';
import { loadSiteSettings, subscribeSiteSettings } from '../lib/siteSettingsStore.js';

function websiteHref(doc, site) {
  const raw = String(doc.website || site.contactWebsite || site.canonicalUrl || '').trim();
  if (!raw) return typeof location !== 'undefined' ? location.origin : '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw;
  return `https://${raw}`;
}

function displayUrl(href) {
  return String(href || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

export function RichText({ text }) {
  const nodes = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m;
  let i = 0;
  const src = String(text || '');
  while ((m = re.exec(src))) {
    if (m.index > last) nodes.push(src.slice(last, m.index));
    const href = m[2];
    const internal = href.startsWith('/');
    nodes.push(
      <a key={i++} href={href} {...(internal ? {} : { target: '_blank', rel: 'noreferrer' })}>
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < src.length) nodes.push(src.slice(last));
  return <>{nodes}</>;
}

export default function LegalDocPage({
  load,
  subscribe,
  kicker = 'POLICY',
  title,
  lede,
  chip = 'Effective for the website, dashboards, APIs and research tools',
  railKicker,
  railTitle,
  railCopy,
  railCta,
  muteKicker,
  muteCopy,
  teamFallback,
  showLaw = false,
}) {
  const [doc, setDoc] = useState(() => load());
  const [site, setSite] = useState(() => loadSiteSettings());
  const [active, setActive] = useState(doc.sections[0]?.id || '');

  useEffect(() => subscribe(setDoc), [subscribe]);
  useEffect(() => subscribeSiteSettings(setSite), []);

  const href = websiteHref(doc, site);
  const email = doc.email || site.contactEmail;
  const address = doc.address || site.contactAddress;
  const org = doc.org || site.siteName;
  const sections = useMemo(() => doc.sections || [], [doc]);

  useEffect(() => {
    const nodes = sections.map((s) => document.getElementById(`pp-${s.id}`)).filter(Boolean);
    if (!nodes.length) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis?.target?.id) setActive(vis.target.id.replace(/^pp-/, ''));
      },
      { rootMargin: '-18% 0px -62% 0px', threshold: [0, 0.2, 0.5, 1] },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [sections]);

  function jump(id) {
    document.getElementById(`pp-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  }

  return (
    <div className="pp">
      <div className="pp-art" aria-hidden="true">
        <span className="pp-scan" />
        <span className="pp-grid" />
        <span className="pp-sh navy" />
        <span className="pp-sh sand" />
        <span className="pp-sh purple" />
        <span className="pp-sh red" />
        <span className="pp-ring" />
        <span className="pp-ring r2" />
      </div>

      <header className="mkt-wrap pp-hero">
        <p className="pp-kicker">
          <span>{kicker}</span>
          <i />
          <span>LEGAL / {String(sections.length).padStart(2, '0')}</span>
        </p>
        <h1>{title}</h1>
        <p className="pp-lede">{lede.replace('{org}', org)}</p>
        <div className="pp-chips">
          <span>
            Last updated <b>{doc.lastUpdated || '—'}</b>
          </span>
          <span>{sections.length} sections</span>
          <span>{chip}</span>
        </div>
      </header>

      <div className="mkt-wrap pp-layout">
        <nav className="pp-toc" aria-label="Document sections">
          <p>Contents</p>
          <ol>
            {sections.map((s) => (
              <li key={s.id}>
                <button type="button" className={active === s.id ? 'on' : ''} onClick={() => jump(s.id)}>
                  <em>{s.num}</em>
                  {s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <article className="pp-doc">
          {sections.map((s, i) => {
            const blocks = parsePolicyBody(s.body);
            const isContact = s.id === 'contact';
            const isLaw = showLaw && s.id === 'law';
            return (
              <section key={s.id} id={`pp-${s.id}`} className="pp-sec">
                <header>
                  <span className={`pp-num n${i % 3}`}>{s.num}</span>
                  <h2>{s.title}</h2>
                </header>
                {blocks.map((b, bi) => {
                  if (b.type === 'h') return <h3 key={bi}>{b.text}</h3>;
                  if (b.type === 'note') {
                    return (
                      <aside key={bi} className="pp-note">
                        <RichText text={b.text} />
                      </aside>
                    );
                  }
                  if (b.type === 'ul') {
                    return (
                      <ul key={bi}>
                        {b.items.map((item, ii) => (
                          <li key={ii}>
                            <RichText text={item} />
                          </li>
                        ))}
                      </ul>
                    );
                  }
                  return (
                    <p key={bi}>
                      <RichText text={b.text} />
                    </p>
                  );
                })}
                {isLaw ? (
                  <div className="pp-contact">
                    <div>
                      <span>Governing law</span>
                      <b>{doc.jurisdiction || 'To be confirmed by the Legal / Compliance Team.'}</b>
                    </div>
                    <div>
                      <span>Courts / forum</span>
                      <b>{doc.courts || 'To be confirmed by the Legal / Compliance Team.'}</b>
                    </div>
                  </div>
                ) : null}
                {isContact ? (
                  <div className="pp-contact">
                    <div>
                      <span>Organisation</span>
                      <b>{org}</b>
                    </div>
                    <div>
                      <span>Team</span>
                      <b>{doc.team || teamFallback}</b>
                    </div>
                    <div>
                      <span>Email</span>
                      {email ? (
                        <a href={`mailto:${email}`}>{email}</a>
                      ) : (
                        <b>Add a contact email in Site settings</b>
                      )}
                    </div>
                    <div>
                      <span>Website</span>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer">
                          {displayUrl(href)}
                        </a>
                      ) : (
                        <b>—</b>
                      )}
                    </div>
                    <div className="span2">
                      <span>Address</span>
                      <b>{address || 'Registered business address to be confirmed by the operator.'}</b>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </article>

        <aside className="pp-rail">
          <div className="pp-card">
            <p className="pp-card-k">{railKicker}</p>
            <h3>{railTitle}</h3>
            <p>{railCopy}</p>
            {email ? (
              <a className="mkt-cta" href={`mailto:${email}`}>
                {railCta}
              </a>
            ) : null}
          </div>
          <div className="pp-card mute">
            <p className="pp-card-k">{muteKicker}</p>
            <p>{muteCopy}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
