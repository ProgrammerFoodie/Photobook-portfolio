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
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".7"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.8 7.2l8.2 6 8.2-6"/>',
  facebook: '<path d="M14.2 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8.600v3h2.600V21z"/>',
  tiktok: '<path d="M16.6 4.2c.3 1.9 1.4 3.2 3.4 3.4v3.100c-1.300 0-2.500-.4-3.400-1v5.400c0 3-2.300 5.100-5.100 5.100S6.400 18.100 6.400 15.300c0-3.100 2.600-5.300 5.700-5v3.200c-1.400-.4-2.600.6-2.600 1.900 0 1.100.9 2 2 2s2-.8 2-2.100V4.200z"/>',
  youtube: '<path d="M21.600 7.500a2.500 2.500 0 0 0-1.800-1.800C18.200 5.300 12 5.300 12 5.300s-6.200 0-7.800.4a2.500 2.500 0 0 0-1.800 1.800C2 9.100 2 12 2 12s0 2.900.4 4.500a2.500 2.500 0 0 0 1.800 1.800c1.600.4 7.800.4 7.800.4s6.200 0 7.800-.4a2.500 2.500 0 0 0 1.800-1.800c.4-1.600.4-4.500.4-4.500s0-2.900-.4-4.500zM10 15V9l5.200 3z"/>',
  x: '<path d="M17.600 3.500h3L14 11l7.700 9.500h-6l-4.700-5.900-5.300 5.900H2.700l7.100-8L2.300 3.500h6.200l4.200 5.400zm-1.100 15.200h1.700L7.500 5.200H5.700z"/>',
  telegram: '<path d="M21.200 4.500 2.800 11.600c-.9.300-.9.900-.2 1.100l4.700 1.500 1.800 5.600c.2.600.4.800.8.800.4 0 .6-.2.900-.5l2.200-2.100 4.600 3.400c.8.500 1.500.2 1.700-.8l3-14.200c.3-1.200-.4-1.700-1.100-1.400zM8.400 13.400l9.200-5.800c.4-.3.800-.1.500.2l-7.600 6.900-.3 3.300z"/>',
  arrowDown: '<path d="M12 5v14m0 0l-6-6m6 6l6-6"/>',
};
const FILLED = new Set(['facebook', 'tiktok', 'youtube', 'x', 'telegram']); // brand glyphs are solid shapes
export const icon = (name, cls = '') =>
  raw(`<svg class="i ${FILLED.has(name) ? 'fill ' : ''}${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`);
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
${body}
<footer class="site-footer"><span>© ${new Date().getFullYear()} ${siteTitle}</span> · <a href="/about">About</a></footer>
<div class="toasts" role="status" aria-live="polite"></div>
${scripts.map((s) => html`<script src="${s}?v=${ASSET_VERSION}" defer></script>`)}
</body>
</html>`;
}

// Cache-buster for static assets; bumps on every process start (cheap, and fine for a small site).
export const ASSET_VERSION = Date.now().toString(36);
