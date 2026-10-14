import { loadSiteSettings } from './siteSettings.js';

const MARK = 'data-niy-site';

function upsertMeta(attr, key, content) {
  const sel = `meta[${attr}="${CSS.escape(key)}"]`;
  let el = document.head.querySelector(sel);
  if (!String(content || '').trim()) {
    if (el?.hasAttribute(MARK)) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    el.setAttribute(MARK, '1');
    document.head.appendChild(el);
  } else {
    el.setAttribute(MARK, '1');
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"][${MARK}]`);
  if (!String(href || '').trim()) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    el.setAttribute(MARK, '1');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function validId(raw, re) {
  const id = String(raw || '').trim();
  return re.test(id) ? id : '';
}

function stripInjectedScripts() {
  document.querySelectorAll(`script[${MARK}], noscript[${MARK}], style[${MARK}]`).forEach((n) => n.remove());
}

function injectGa(id) {
  const s1 = document.createElement('script');
  s1.async = true;
  s1.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  s1.setAttribute(MARK, '1');
  document.head.appendChild(s1);
  const s2 = document.createElement('script');
  s2.setAttribute(MARK, '1');
  s2.textContent =
    `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
    `gtag('js',new Date());gtag('config',${JSON.stringify(id)});`;
  document.head.appendChild(s2);
}

function injectGtm(id) {
  const s = document.createElement('script');
  s.setAttribute(MARK, '1');
  s.textContent =
    `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});` +
    `var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;` +
    `j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;j.setAttribute('${MARK}','1');` +
    `f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(id)});`;
  document.head.appendChild(s);
  if (document.body) {
    const nos = document.createElement('noscript');
    nos.setAttribute(MARK, '1');
    nos.innerHTML = `<iframe src="https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(id)}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`;
    document.body.prepend(nos);
  }
}

function injectCustomHtml(html) {
  const raw = String(html || '').trim();
  if (!raw) return;
  const box = document.createElement('template');
  box.innerHTML = raw;
  for (const node of [...box.content.childNodes]) {
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === 'script') {
      const s = document.createElement('script');
      for (const a of node.attributes) s.setAttribute(a.name, a.value);
      s.textContent = node.textContent || '';
      s.setAttribute(MARK, '1');
      document.head.appendChild(s);
      continue;
    }
    if (tag === 'meta' || tag === 'link' || tag === 'style' || tag === 'noscript') {
      const el = node.cloneNode(true);
      el.setAttribute(MARK, '1');
      (tag === 'noscript' && document.body ? document.body : document.head).appendChild(el);
    }
  }
}

export function applySiteHead(settings) {
  const s = settings || loadSiteSettings();
  const title = s.metaTitle || s.siteName || 'NIYANTRAN TERMINAL';
  document.title = title;

  upsertMeta('name', 'description', s.metaDescription || s.description);
  upsertMeta('name', 'keywords', s.metaKeywords);
  upsertMeta('name', 'robots', s.robots);
  upsertMeta('name', 'author', s.author || s.siteName);
  upsertMeta('name', 'theme-color', s.themeColor);
  upsertMeta('name', 'application-name', s.siteName);
  const lang = String(s.locale || 'en_IN').replace('_', '-');
  document.documentElement.lang = lang.slice(0, 2) || 'en';
  upsertMeta('name', 'language', lang);

  const ogTitle = s.ogTitle || s.metaTitle || s.siteName;
  const ogDesc = s.ogDescription || s.metaDescription || s.description;
  upsertMeta('property', 'og:title', ogTitle);
  upsertMeta('property', 'og:description', ogDesc);
  upsertMeta('property', 'og:type', s.ogType || 'website');
  upsertMeta('property', 'og:site_name', s.siteName);
  upsertMeta('property', 'og:locale', s.locale || 'en_IN');
  upsertMeta('property', 'og:image', s.ogImage);
  const url = String(s.canonicalUrl || '').trim();
  upsertMeta('property', 'og:url', url);
  upsertLink('canonical', url);

  upsertMeta('name', 'twitter:card', s.twitterCard || 'summary_large_image');
  upsertMeta('name', 'twitter:title', ogTitle);
  upsertMeta('name', 'twitter:description', ogDesc);
  upsertMeta('name', 'twitter:image', s.ogImage);
  upsertMeta('name', 'twitter:site', s.twitterHandle);

  upsertLink('icon', s.faviconUrl);

  stripInjectedScripts();
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.setAttribute(MARK, '1');
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: s.siteName,
    alternateName: s.shortName,
    description: s.description || s.metaDescription,
    url: url || (typeof location !== 'undefined' ? location.origin : ''),
  });
  document.head.appendChild(ld);

  const ga = validId(s.googleAnalyticsId, /^(G-[A-Z0-9]+|UA-\d+-\d+|AW-[A-Z0-9]+|GT-[\w]+)$/i);
  const gtm = validId(s.googleTagManagerId, /^GTM-[A-Z0-9]+$/i);
  if (gtm) injectGtm(gtm);
  if (ga) injectGa(ga);
  injectCustomHtml(s.customHeadHtml);
}

// The published values never change while the page is open, so one application is enough.
export function startSiteHead() {
  applySiteHead();
  return () => {};
}

export function setPageTitle(pageTitle) {
  const s = loadSiteSettings();
  const name = s.siteName || 'NIYANTRAN TERMINAL';
  document.title = pageTitle ? `${pageTitle} · ${name}` : s.metaTitle || name;
}
