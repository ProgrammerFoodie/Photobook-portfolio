/** Social links shown as icons on the book cover, the open book and the About page. */

export const SOCIALS = [
  { key: 'instagram', label: 'Instagram', url: (h) => `https://instagram.com/${h}` },
  { key: 'facebook', label: 'Facebook', url: (h) => `https://facebook.com/${h}` },
  { key: 'tiktok', label: 'TikTok', url: (h) => `https://www.tiktok.com/@${h}` },
  { key: 'youtube', label: 'YouTube', url: (h) => `https://youtube.com/@${h}` },
  { key: 'x', label: 'X', url: (h) => `https://x.com/${h}` },
  { key: 'telegram', label: 'Telegram', url: (h) => `https://t.me/${h}` },
];
export const SOCIAL_KEYS = SOCIALS.map((s) => s.key);

/**
 * "@name" or "name" → the network's profile URL; an http(s) link is kept as given.
 * Returns '' for empty input and null for anything that is not a plain handle or a web link
 * (so "javascript:…" and the like can never end up in an href).
 */
export function normalizeSocial(key, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.length > 300) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
    } catch { return null; }
  }
  const social = SOCIALS.find((s) => s.key === key);
  const handle = value.replace(/^@/, '');
  return social && /^[A-Za-z0-9._-]{1,64}$/.test(handle) ? social.url(handle) : null;
}

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** [{ key, label, url }] for everything that is filled in and valid, email last. */
export function socialLinks(settings) {
  const links = [];
  for (const s of SOCIALS) {
    const url = normalizeSocial(s.key, settings[s.key]);
    if (url) links.push({ key: s.key, label: s.label, url });
  }
  const mail = String(settings.contact_email ?? '').trim();
  if (EMAIL.test(mail)) links.push({ key: 'mail', label: 'Email', url: `mailto:${mail}` });
  return links;
}
