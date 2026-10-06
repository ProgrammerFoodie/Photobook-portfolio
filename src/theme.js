/**
 * THEME — the single place where the site's colours live.
 *
 * To change the palette you can either:
 *   1. use Admin → Settings → Palette (colour pickers, or paste a coolors.co link), or
 *   2. edit DEFAULT_THEME below (used when nothing is saved in the admin).
 *
 * Every stylesheet uses only the CSS variables generated here (see buildThemeCss);
 * no other file contains a colour value.
 */
export const DEFAULT_THEME = {
  surface: '#63361E', // the "desk" the book lies on (public pages); panels in the admin
  base: '#402313',    // ink: dark text on paper (darkened a little in buildThemeCss); photo viewer background
  accent: '#E37C44',  // colour blocks, buttons, likes, focus rings
  accent2: '#BA6538', // hover / secondary accent / warm glow on the desk
  muted: '#914F2C',   // borders, rules, chips
  text: '#F6EBE1',    // the paper (pages) and light text on dark backgrounds
};

/** Order in which a pasted palette is assigned to roles (matches the original palette image). */
export const PALETTE_ORDER = ['surface', 'base', 'accent', 'accent2', 'muted'];

export const ROLE_LABELS = {
  surface: 'Desk (page background)',
  base: 'Ink (text on paper)',
  accent: 'Accent (colour blocks, buttons)',
  accent2: 'Accent hover & desk glow',
  muted: 'Borders & rules',
  text: 'Paper (pages)',
};

const HEX6 = /^#[0-9a-f]{6}$/i;
const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua','Source Serif Pro',Georgia,serif";
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim();
  if (/^#?[0-9a-f]{3}$/i.test(v)) {
    v = v.replace('#', '');
    v = '#' + [...v].map((c) => c + c).join('');
  } else if (/^[0-9a-f]{6}$/i.test(v)) {
    v = '#' + v;
  }
  return HEX6.test(v) ? v.toUpperCase() : null;
}

/** Merge a (possibly partial / invalid) saved theme over the defaults. */
export function resolveTheme(saved) {
  const out = { ...DEFAULT_THEME };
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(DEFAULT_THEME)) {
      const hex = normalizeHex(saved[k]);
      if (hex) out[k] = hex;
    }
  }
  return out;
}

export function parseStoredTheme(json) {
  try { return resolveTheme(json ? JSON.parse(json) : null); } catch { return { ...DEFAULT_THEME }; }
}

/**
 * Pull colours out of arbitrary text: "#aabbcc, #112233", a coolors.co URL
 * ("coolors.co/63361e-402313-e37c44"), or a plain list. Returns ['#AABBCC', ...].
 */
export function parsePalette(text) {
  if (typeof text !== 'string') return [];
  const withHash = [...text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi)].map((m) => normalizeHex(m[0]));
  if (withHash.length) return withHash.filter(Boolean);
  return text
    .split(/[\s,;\-/]+/)
    .filter((t) => /^[0-9a-f]{6}$/i.test(t))
    .map(normalizeHex);
}

/** Assign a parsed palette to roles in PALETTE_ORDER. */
export function paletteToTheme(colors, base = DEFAULT_THEME) {
  const theme = { ...base };
  PALETTE_ORDER.forEach((role, i) => { if (colors[i]) theme[role] = colors[i]; });
  return theme;
}

/** CSS rules; the derived tokens use color-mix so they follow the six base colours. */
export function buildThemeCss(saved) {
  const t = resolveTheme(saved);
  // .theme-scope lets the admin preview re-derive tokens from locally overridden base colours.
  return `:root,.theme-scope{
--surface:${t.surface};--base:${t.base};--accent:${t.accent};--accent2:${t.accent2};--muted:${t.muted};--text:${t.text};
--bg:color-mix(in srgb,var(--base) 55%,#000);
--bg-lightbox:color-mix(in srgb,var(--base) 15%,#000);
--surface-hover:color-mix(in srgb,var(--surface) 82%,var(--text));
--text-dim:color-mix(in srgb,var(--text) 68%,var(--bg));
--border:color-mix(in srgb,var(--muted) 55%,var(--bg));
--on-accent:var(--bg);
--shadow:0 6px 24px color-mix(in srgb,var(--bg) 70%,transparent);
--desk:color-mix(in srgb,var(--surface) 78%,var(--base));
--desk-glow:color-mix(in srgb,var(--accent2) 40%,var(--desk));
--paper:color-mix(in srgb,var(--text) 86%,#fff);
--paper-shade:color-mix(in srgb,var(--paper) 88%,var(--muted));
--ink:var(--bg);
--ink-dim:color-mix(in srgb,var(--ink) 64%,var(--paper));
--rule:color-mix(in srgb,var(--ink) 16%,var(--paper));
--link:color-mix(in srgb,var(--accent2) 70%,var(--ink));
--radius:10px;--font-sans:${FONT};--font-serif:${SERIF};
color-scheme:dark;
}
`;
}

// ---- contrast helpers (used by the admin palette editor and tests) ----

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Mirrors `--bg` in buildThemeCss (base mixed 55% with black, in sRGB). */
export function deriveBg(base) {
  const n = parseInt(base.slice(1), 16);
  const f = (v) => Math.round(v * 0.55).toString(16).padStart(2, '0');
  return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
}

/** Mirrors `--paper` (text mixed 14% towards white). */
export function derivePaper(text) {
  const n = parseInt(text.slice(1), 16);
  const f = (v) => Math.round(v * 0.86 + 255 * 0.14).toString(16).padStart(2, '0');
  return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
}
/** Mirrors `--link` (accent2 70% + ink 30%). */
export function deriveLink(accent2, base) {
  const a = parseInt(accent2.slice(1), 16), i = parseInt(deriveBg(base).slice(1), 16);
  const f = (x, y) => Math.round(x * 0.7 + y * 0.3).toString(16).padStart(2, '0');
  return '#' + f(a >> 16, i >> 16) + f((a >> 8) & 255, (i >> 8) & 255) + f(a & 255, i & 255);
}
