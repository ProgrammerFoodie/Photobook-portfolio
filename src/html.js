/** Tiny auto-escaping HTML templating. Only raw() output is trusted. */
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

function render(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/** Serialise data for an inline <script type="application/json"> block. */
export const jsonForScript = (data) =>
  raw(JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029'));

/** Inline SVG sprite; use icon('heart'). Stroke icons so they pick up currentColor. */
const ICONS = {
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.3C1.5 8 3.4 4.8 6.6 4.8c2 0 3.6 1.1 5.4 3.2 1.8-2.1 3.4-3.2 5.4-3.2 3.2 0 5.1 3.2 3.9 6.4-1.8 4.7-9.3 9.3-9.3 9.3z"/>',
  download: '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/>',
  share: '<path d="M12 15V4m0 0L8 8m4-4l4 4M6 12v6.5a1 1 0 001 1h10a1 1 0 001-1V12"/>',
  play: '<path d="M7 4.8v14.4a.6.6 0 00.9.5l11.5-7.2a.6.6 0 000-1L7.9 4.3a.6.6 0 00-.9.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4M11 8.5v5M8.5 11h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>',
  arrowDown: '<path d="M12 5v14m0 0l-6-6m6 6l6-6"/>',
};
export const icon = (name, cls = '') =>
  raw(`<svg class="i ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`);
const sprite = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(ICONS)
    .map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`)
    .join('')}</svg>`;

/**
 * Public page shell.
 * meta: { title, description, image, url, type }  (image/url must already be absolute)
 */
export function layout({ settings, themeVersion, meta, active = '', body, scripts = [], bodyClass = '' }) {
  const siteTitle = settings.site_title;
  const title = meta.title && meta.title !== siteTitle ? `${meta.title} · ${siteTitle}` : siteTitle;
  const description = meta.description || settings.tagline || '';
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${meta.noindex ? raw('<meta name="robots" content="noindex">') : ''}
<meta name="theme-color" content="#23130a">
<meta property="og:site_name" content="${siteTitle}">
<meta property="og:type" content="${meta.type || 'website'}">
<meta property="og:title" content="${meta.title || siteTitle}">
<meta property="og:description" content="${description}">
${meta.url ? html`<meta property="og:url" content="${meta.url}"><link rel="canonical" href="${meta.url}">` : ''}
${meta.image ? html`<meta property="og:image" content="${meta.image}"><meta name="twitter:card" content="summary_large_image">` : html`<meta name="twitter:card" content="summary">`}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/theme.css?v=${themeVersion}.${ASSET_VERSION}">
<link rel="stylesheet" href="/css/site.css?v=${ASSET_VERSION}">
<link rel="stylesheet" href="/css/book.css?v=${ASSET_VERSION}">
</head>
<body class="book ${bodyClass}">
${raw(sprite())}
<header class="site-header">
  <a class="brand" href="/">${siteTitle}</a>
  <nav aria-label="Main">
    <a href="/" ${active === 'albums' ? raw('aria-current="page"') : ''}>Albums</a>
    <a href="/about" ${active === 'about' ? raw('aria-current="page"') : ''}>About</a>
  </nav>
</header>
${body}
<footer class="site-footer"><span>© ${new Date().getFullYear()} ${siteTitle}</span></footer>
<div class="toasts" role="status" aria-live="polite"></div>
${scripts.map((s) => html`<script src="${s}?v=${ASSET_VERSION}" defer></script>`)}
</body>
</html>`;
}

// Cache-buster for static assets; bumps on every process start (cheap, and fine for a small site).
export const ASSET_VERSION = Date.now().toString(36);
