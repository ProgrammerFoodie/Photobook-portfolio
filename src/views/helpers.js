import { PUBLIC_URL } from '../config.js';

export const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

export const thumbUrl = (p) => `/img/${p.id}/thumb.webp?v=${p.version}`;
export const displayUrl = (p) => `/img/${p.id}/display.webp?v=${p.version}`;
export const ogUrl = (p) => `/img/${p.id}/og.jpg?v=${p.version}`;
export const originalUrl = (p) => `/img/${p.id}/original?v=${p.version}`;

/** Width of a derivative given the original size and the long-edge cap. */
export function derivedWidth(p, cap) {
  const long = Math.max(p.width, p.height) || 1;
  return Math.max(1, Math.round(p.width * Math.min(1, cap / long)));
}
export function derivedHeight(p, cap) {
  const long = Math.max(p.width, p.height) || 1;
  return Math.max(1, Math.round(p.height * Math.min(1, cap / long)));
}

const FMT = { month: 'short', year: 'numeric', timeZone: 'UTC' };
/** '2026-10-06' | '2026-10' | '2026' → 'Oct 2026' | '2026' */
export function formatDate(d) {
  if (!d) return '';
  if (/^\d{4}$/.test(d)) return d;
  const date = new Date(/^\d{4}-\d{2}$/.test(d) ? `${d}-01T00:00:00Z` : `${d}T00:00:00Z`);
  return Number.isNaN(+date) ? '' : date.toLocaleDateString('en', FMT);
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatBytes(n) {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${Math.round(n / 1048576)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
