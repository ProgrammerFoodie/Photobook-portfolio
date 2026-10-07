import { esc, raw } from './html.js';

/**
 * The About text: a small, safe formatting syntax, plus the short intro shown on the title page.
 *
 *   **bold**   *italic*   [link text](https://example.com)   https://bare-links.work
 *   ## Heading        - bullet list        1. numbered list
 *   a blank line starts a new paragraph; a single line break stays a line break
 *
 * Everything is escaped first, so nothing typed here can inject HTML.
 */

/** Longest intro, in characters, the title page shows before cutting it off. */
export const INTRO_MAX = 256;

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

function anchor(url, label) {
  return `<a href="${url}" rel="noopener nofollow ugc" target="_blank">${label}</a>`;
}

function inline(text) {
  const keep = [];
  const stash = (htmlText) => `\u0000${keep.push(htmlText) - 1}\u0000`;
  let s = esc(String(text).replace(/\u0000/g, ''));
  s = s.replace(LINK_RE, (_, label, url) => stash(anchor(url, label)));
  s = s.replace(URL_RE, (url) => stash(anchor(url, url)));
  s = s.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}

/** The text as a reader sees it, without the formatting marks. */
function plain(text) {
  return String(text)
    .replace(LINK_RE, '$1')
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^\s*[-*•]\s+(.+)$/;
const NUMBER = /^\s*\d+[.)]\s+(.+)$/;

/** Split the text into paragraphs, headings and lists. */
export function parseAbout(text) {
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) blocks.push({ t: 'p', lines: para }); para = []; };
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    let m;
    if (!line.trim()) flush();
    else if ((m = HEADING.exec(line))) { flush(); blocks.push({ t: 'h', level: m[1].length, text: m[2].trim() }); }
    else if ((m = BULLET.exec(line))) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.t === 'ul') last.items.push(m[1].trim()); else blocks.push({ t: 'ul', items: [m[1].trim()] });
    } else if ((m = NUMBER.exec(line))) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.t === 'ol') last.items.push(m[1].trim()); else blocks.push({ t: 'ol', items: [m[1].trim()] });
    } else para.push(line.trim());
  }
  flush();
  return blocks;
}

/** The About text as safe HTML (a trusted raw() value), for the About page and the admin preview. */
export function renderAbout(text) {
  const out = parseAbout(text).map((b) => {
    if (b.t === 'h') return `<h${b.level + 1}>${inline(b.text)}</h${b.level + 1}>`; // the page's own title is the h1
    if (b.t === 'ul' || b.t === 'ol') return `<${b.t}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${b.t}>`;
    return `<p>${b.lines.map(inline).join('<br>')}</p>`;
  });
  return raw(out.join('\n'));
}

/** Plain text of the first paragraph (what the intro on the title page and link previews are made from). */
export function firstParagraph(text) {
  const blocks = parseAbout(text);
  const b = blocks.find((x) => x.t === 'p') || blocks.find((x) => x.t !== 'h') || blocks[0];
  if (!b) return '';
  if (b.t === 'p') return plain(b.lines.join(' '));
  if (b.t === 'h') return plain(b.text);
  return plain(b.items.join(' · '));
}

/**
 * The intro on the title page: the first paragraph, cut at INTRO_MAX characters (back to a whole word).
 * `shown` is what appears there, `rest` is what gets cut off; the admin shows both.
 */
export function introParts(text, fallback = '') {
  const full = firstParagraph(text) || String(fallback || '');
  if (full.length <= INTRO_MAX) return { shown: full, rest: '', total: full.length, max: INTRO_MAX, truncated: false };
  const shown = full.slice(0, INTRO_MAX).replace(/\s+\S*$/, '');
  return { shown, rest: full.slice(shown.length), total: full.length, max: INTRO_MAX, truncated: true };
}

/** The intro as it is printed: with an ellipsis when it was cut. */
export function introText(text, fallback = '') {
  const p = introParts(text, fallback);
  return p.truncated ? `${p.shown.replace(/[\s.,;:!?–—-]+$/, '')}…` : p.shown;
}
