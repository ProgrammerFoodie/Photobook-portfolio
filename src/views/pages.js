import { html, raw, esc, icon, jsonForScript, layout } from '../html.js';
import { socialLinks } from '../social.js';
import { baseUrl, thumbUrl, displayUrl, ogUrl, derivedWidth, derivedHeight, formatDate, plural, formatBytes } from './helpers.js';

const shell = (req, settings, args) =>
  layout({ settings, themeVersion: settings.theme_version, ...args });

const PLACEHOLDER = 'Find your car: model, number, plate…';

/** Search box with native autocomplete suggestions (no JS needed). */
function searchBox({ action, value = '', options = [], id, label }) {
  return html`
<form class="search" action="${action}" method="get" role="search">
  <input type="search" name="q" value="${value}" placeholder="${PLACEHOLDER}" aria-label="${label}" list="${id}" autocomplete="off" maxlength="80">
  <button class="btn" type="submit">${icon('search')} Search</button>
</form>
<datalist id="${id}">${options.map((o) => html`<option value="${o.name}"></option>`)}</datalist>`;
}

/** Icon-only social links (accessible names, opens in a new tab; email opens the mail app). */
function socialRow(links, where) {
  return links.length ? html`<div class="socials ${where}">${links.map((l) => html`<a class="social" href="${l.url}" ${l.key === 'mail' ? '' : raw('target="_blank"')} rel="noopener" aria-label="${l.label}" title="${l.label}">${icon(l.key)}</a>`)}</div>` : '';
}

// ---------- home: cover + highlights spread + contents ----------
const pad2 = (n) => String(n).padStart(2, '0');

/** First paragraph of the About text, trimmed to a readable length for the spread. */
function introText(about, fallback) {
  const first = String(about || '').split(/\n{2,}/).map((x) => x.trim()).find(Boolean) || fallback || '';
  if (first.length <= 300) return first;
  return first.slice(0, 300).replace(/\s+\S*$/, '') + '…';
}

/** A highlight photo as a framed figure that opens in the viewer on its album page. */
function plate(p, cls = '', { i = 0, sizes = '(min-width:1000px) 20vw, 60vw' } = {}) {
  return html`<figure class="plate ${cls}" style="--c:${p.color};--i:${i}"><a href="/a/${p.album_slug}/p/${p.id}">
    <img src="${thumbUrl(p)}" srcset="${thumbUrl(p)} ${derivedWidth(p, 800)}w, ${displayUrl(p)} ${derivedWidth(p, 2048)}w" sizes="${sizes}"
      width="${derivedWidth(p, 800)}" height="${derivedHeight(p, 800)}" alt="${p.caption || p.album_title}" decoding="async"></a></figure>`;
}

export function homeView(req, { settings, albums, categories, activeCat, highlights = [], suggestions = [] }) {
  const base = baseUrl(req);
  const [hCover, hBig, ...small] = highlights;
  const coverPhoto = hCover || (albums[0] ? { ...albums[0].cover, album_slug: albums[0].slug, album_title: albums[0].title } : null);
  const year = new Date().getFullYear();
  const links = socialLinks(settings);
  const showSpread = !!hBig;
  const [s1, s2, s3] = small;
  const body = html`
<main class="landing wrap">
  <section class="stage${showSpread ? '' : ' solo'}${links.length ? ' has-socials' : ''}" aria-label="Title page">
    <div class="slider"><div class="book">
      ${showSpread ? html`
      <div class="shadow" aria-hidden="true"></div>
      <article class="leaf right page" aria-label="Page 3">
        ${plate(hBig, 'big', { sizes: '(min-width:1000px) 42vw, 90vw' })}
        <span class="folio end">Page 3</span>
      </article>
      <div class="flip">
        <article class="cover page face front" aria-label="Cover">
          <i class="shade" aria-hidden="true"></i>
          <p class="cover-kicker">${settings.tagline}</p>
          <h1 class="cover-title">${settings.site_title}${settings.cover_subtitle ? html`<small>${settings.cover_subtitle}</small>` : ''}</h1>
          <div class="cover-art">
            <span class="block" aria-hidden="true"></span>
            ${coverPhoto ? plate(coverPhoto, 'cover-photo', { sizes: '(min-width:1000px) 28vw, 80vw' }) : html`<div class="plate cover-photo empty-plate"></div>`}
          </div>
          <p class="cover-foot">${year}</p>
          ${socialRow(links, 'on-cover')}
        </article>
        <article class="page face back left" aria-label="Page 2">
          <i class="shade" aria-hidden="true"></i>
          <div class="collage">
            ${s1 || s2 ? html`<div class="col">${s1 ? plate(s1, 'tall', { i: 0 }) : ''}${s2 ? plate(s2, 'square', { i: 1 }) : ''}</div>` : ''}
            <div class="col">
              <div class="note">
                <h2>${settings.intro_title}</h2>
                <p>${introText(settings.about, settings.tagline)}</p>
                <a class="more-link" href="/about">About me →</a>
              </div>
              ${s3 ? plate(s3, 'grow', { i: 2 }) : ''}
            </div>
          </div>
          ${socialRow(links, 'on-page')}
          <span class="folio">Page 2</span>
        </article>
      </div>` : html`
      <article class="cover page face front" aria-label="Cover">
        <p class="cover-kicker">${settings.tagline}</p>
        <h1 class="cover-title">${settings.site_title}${settings.cover_subtitle ? html`<small>${settings.cover_subtitle}</small>` : ''}</h1>
        <div class="cover-art">
          <span class="block" aria-hidden="true"></span>
          ${coverPhoto ? plate(coverPhoto, 'cover-photo', { sizes: '(min-width:1000px) 28vw, 80vw' }) : html`<div class="plate cover-photo empty-plate"></div>`}
        </div>
        <p class="cover-foot">${year}</p>
        ${socialRow(links, 'on-cover')}
      </article>`}
    </div></div>
    <a class="cue" href="#contents" aria-label="Contents">${icon('arrowDown')}</a>
  </section>

  <section class="sheet" id="contents" aria-labelledby="contents-h">
    <header class="sheet-head"><span class="bar" aria-hidden="true"></span><h2 id="contents-h">Contents</h2></header>
    ${suggestions.length ? searchBox({ action: '/search', options: suggestions, id: 'site-tags', label: 'Search all photos' }) : ''}
    ${categories.length > 1 ? html`
    <nav class="chips" aria-label="Filter albums">
      <a class="chip" href="/#contents" ${!activeCat ? raw('aria-current="true"') : ''}>All</a>
      ${categories.map((c) => html`<a class="chip" href="/?c=${encodeURIComponent(c)}#contents" ${c === activeCat ? raw('aria-current="true"') : ''}>${c}</a>`)}
    </nav>` : ''}
    ${albums.length ? html`
    <ol class="chapters">
      ${albums.map((a, i) => html`
      <li><a class="chapter" href="/a/${a.slug}">
        <div class="chapter-img" style="--c:${a.cover.color}">
          <img src="${thumbUrl(a.cover)}" width="${derivedWidth(a.cover, 800)}" height="${derivedHeight(a.cover, 800)}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async">
          <span class="num">${pad2(i + 1)}</span>
        </div>
        <h3>${a.title}</h3>
        <p>${[plural(a.photo_count, 'photo'), formatDate(a.date)].filter(Boolean).join(' · ')}</p>
      </a></li>`)}
    </ol>` : html`<p class="empty">${activeCat ? 'No albums in this category yet.' : 'No albums yet. Check back soon.'}</p>`}
  </section>
</main>`;
  return shell(req, settings, {
    meta: {
      title: settings.site_title, description: settings.tagline, url: `${base}/`,
      image: coverPhoto ? base + ogUrl(coverPhoto) : '',
    },
    active: 'albums', body, scripts: showSpread ? ['/js/book.js'] : [],
  });
}

// ---------- album ----------
function tagChips(album, tagCounts, total, activeTag, filtered) {
  if (!tagCounts.length) return '';
  const chip = (t) => html`<a class="chip" href="/a/${album.slug}?tag=${encodeURIComponent(t.slug)}" ${t.slug === activeTag ? raw('aria-current="true"') : ''}>${t.name} <span class="n">${t.n}</span></a>`;
  const SHOWN = 14;
  const head = tagCounts.slice(0, SHOWN);
  const rest = tagCounts.slice(SHOWN);
  return html`
  <nav class="chips" aria-label="Tags">
    <a class="chip" href="/a/${album.slug}" ${!filtered ? raw('aria-current="true"') : ''}>All <span class="n">${total}</span></a>
    ${head.map(chip)}
    ${rest.length ? html`<details class="more" ${rest.some((t) => t.slug === activeTag) ? raw('open') : ''}>
      <summary class="chip">+${rest.length} more</summary>
      <div class="chips">${rest.map(chip)}</div>
    </details>` : ''}
  </nav>`;
}

export function albumView(req, { settings, album, photos, liked, openId, totalBytes, total, filter, filtered, tagName, tagCounts, tagMap }) {
  const base = baseUrl(req);
  const open = openId ? photos.find((p) => p.id === openId) : null;
  const lead = open || photos.find((p) => p.id === album.cover_photo_id) || photos[0];
  const leadIndex = lead ? photos.indexOf(lead) : -1;
  const label = tagName || (filter.q ? `“${filter.q}”` : '');
  const kicker = [album.category, formatDate(album.date)].filter(Boolean).join(' · ');
  const meta = [plural(photos.length, 'photo'), formatDate(album.date), album.category].filter(Boolean).join(' · ');
  const data = {
    album: { slug: album.slug, title: album.title, allowDownload: !!album.allow_download },
    openId: open ? open.id : null,
    photos: photos.map((p) => ({
      id: p.id, w: p.width, h: p.height, v: p.version, c: p.color, cap: p.caption,
      exif: JSON.parse(p.exif || '{}'), taken: p.taken_at, likes: p.likes, liked: liked.has(p.id) ? 1 : 0,
      t: (tagMap.get(p.id) || []).map((t) => [t.name, t.slug]),
    })),
  };
  const body = html`
<main class="wrap album">
  <section class="opener" aria-label="Chapter opening">
    <div class="page left">
      <a class="crumb" href="/#contents">← Contents</a>
      <span class="bar" aria-hidden="true"></span>
      ${kicker ? html`<p class="kicker">${kicker}</p>` : ''}
      <h1>${album.title}</h1>
      <p class="meta">${plural(photos.length, 'photo')}${filtered ? html` · <em>${label}</em>` : ''}</p>
      ${album.description ? html`<p class="desc">${album.description}</p>` : ''}
      ${photos.length ? html`
      <div class="actions">
        <button class="btn btn-primary" type="button" id="btn-slideshow">${icon('play')} Slideshow</button>
        ${album.allow_download ? html`<a class="btn" href="/dl/a/${album.slug}.zip${filter.qs}" download>${icon('download')} ${filtered ? `Download these ${photos.length}` : 'Download all'} <span class="dim">(${formatBytes(totalBytes)})</span></a>` : ''}
        <button class="btn" type="button" id="btn-share-album">${icon('share')} Share${filtered ? ' this view' : ''}</button>
      </div>` : ''}
      <span class="folio">Page 1</span>
    </div>
    <div class="page right">
      ${lead ? html`<figure class="plate lead" style="--c:${lead.color}"><a href="/a/${album.slug}/p/${lead.id}${filter.qs}" data-index="${leadIndex}" aria-label="Open photo ${leadIndex + 1}">
        <img src="${displayUrl(lead)}" srcset="${thumbUrl(lead)} ${derivedWidth(lead, 800)}w, ${displayUrl(lead)} ${derivedWidth(lead, 2048)}w" sizes="(min-width:900px) 520px, 90vw"
          width="${derivedWidth(lead, 2048)}" height="${derivedHeight(lead, 2048)}" alt="${lead.caption || album.title}" fetchpriority="high" decoding="async"></a></figure>` : html`<div class="plate lead empty-plate"></div>`}
      <span class="folio end">Page 2</span>
    </div>
  </section>

  <section class="sheet" aria-label="Photos">
    ${total > 0 && (tagCounts.length || total > 12) ? searchBox({ action: `/a/${album.slug}`, value: filter.q, options: tagCounts, id: 'album-tags', label: 'Search this album' }) : ''}
    ${tagChips(album, tagCounts, total, filter.tag, filtered)}
    ${filtered ? html`<p class="filter-note">${photos.length ? plural(photos.length, 'photo') : 'No photos'} for <strong>${label}</strong>
      · <a href="/a/${album.slug}">Show all ${total}</a>${album.allow_download && filtered && photos.length ? html` · <a href="/dl/a/${album.slug}.zip" download>Download whole album</a>` : ''}</p>` : ''}
    ${photos.length ? html`
    <div class="grid" id="grid">
      ${photos.map((p, i) => html`
      <figure class="tile" style="--r:${(p.width / p.height).toFixed(4)};--c:${p.color}" data-id="${p.id}">
        <a href="/a/${album.slug}/p/${p.id}${filter.qs}" data-index="${i}" aria-label="Open photo ${i + 1}${p.caption ? ': ' + p.caption : ''}">
          <img src="${thumbUrl(p)}" srcset="${thumbUrl(p)} ${derivedWidth(p, 800)}w, ${displayUrl(p)} ${derivedWidth(p, 2048)}w"
            sizes="(max-width:700px) 60vw, 33vw" width="${derivedWidth(p, 800)}" height="${derivedHeight(p, 800)}"
            alt="${p.caption || (tagMap.get(p.id) || []).map((t) => t.name).join(', ') || `${album.title}, photo ${i + 1}`}" loading="${i < 6 ? 'eager' : 'lazy'}" decoding="async">
        </a>
        <button class="tile-like" type="button" data-id="${p.id}" aria-pressed="${liked.has(p.id) ? 'true' : 'false'}" aria-label="Like this photo">${icon('heart')}</button>
      </figure>`)}
    </div>` : (filtered ? '' : html`<p class="empty">This album has no photos yet.</p>`)}
  </section>
</main>
<script type="application/json" id="album-data">${jsonForScript(data)}</script>`;
  const path = open ? `/a/${album.slug}/p/${open.id}` : `/a/${album.slug}`;
  const title = label ? `${label} · ${album.title}` : album.title;
  return shell(req, settings, {
    meta: {
      title,
      description: label ? `${plural(photos.length, 'photo')} for ${label} from ${album.title}` : (album.description || `${meta} by ${settings.site_title}`),
      url: `${base}${path}${filter.qs}`, image: lead ? base + ogUrl(lead) : '', type: 'article', noindex: !!filter.q,
    },
    active: 'albums', body, scripts: ['/js/site.js', '/js/lightbox.js'],
  });
}

// ---------- site-wide search ----------
export function searchView(req, { settings, q, groups, count, more, suggestions }) {
  const base = baseUrl(req);
  const qs = `?q=${encodeURIComponent(q)}`;
  const body = html`
<main class="wrap results"><div class="sheet">
  <header class="sheet-head">
    <a class="crumb" href="/#contents">← Contents</a>
    <span class="bar" aria-hidden="true"></span><h1>Find your car</h1>
    <p class="meta">Search every album by car model, number, plate or caption.</p>
  </header>
  ${searchBox({ action: '/search', value: q, options: suggestions, id: 'site-tags', label: 'Search all photos' })}
  ${q ? html`<p class="filter-note">${count ? html`${plural(count, 'photo')}${more ? '+' : ''} for <strong>“${q}”</strong>` : html`No photos found for <strong>“${q}”</strong>. Try a shorter word, e.g. just the model.`}</p>` : ''}
  ${groups.map((g) => html`
  <section class="result-group">
    <h2><a href="/a/${g.slug}${qs}">${g.title}</a> <span class="dim">${[plural(g.photos.length, 'photo'), formatDate(g.date)].filter(Boolean).join(' · ')}</span></h2>
    <div class="grid">
      ${g.photos.map((p) => html`
      <figure class="tile" style="--r:${(p.width / p.height).toFixed(4)};--c:${p.color}">
        <a href="/a/${g.slug}/p/${p.id}${qs}">
          <img src="${thumbUrl(p)}" width="${derivedWidth(p, 800)}" height="${derivedHeight(p, 800)}" alt="${p.caption || g.title}" loading="lazy" decoding="async">
        </a>
      </figure>`)}
    </div>
  </section>`)}
</div></main>`;
  return shell(req, settings, {
    meta: { title: q ? `“${q}”` : 'Find your car', description: 'Search all photos', url: `${base}/search${q ? qs : ''}`, noindex: true },
    active: 'albums', body,
  });
}

// ---------- about ----------
function linkify(text) {
  const safe = esc(text);
  return raw(safe.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" rel="noopener nofollow ugc" target="_blank">$1</a>'));
}
export function aboutView(req, { settings }) {
  const paragraphs = settings.about.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const links = socialLinks(settings).filter((l) => l.key !== 'mail');
  const body = html`
<main class="wrap"><article class="page single prose">
  <a class="crumb" href="/#contents">← Contents</a>
  <span class="bar" aria-hidden="true"></span>
  <h1>About</h1>
  ${paragraphs.length ? paragraphs.map((p) => html`<p>${linkify(p)}</p>`) : html`<p class="empty">Nothing here yet.</p>`}
  ${settings.contact_email || links.length ? html`
  <p class="contact">
    ${settings.contact_email ? html`<a class="btn" href="mailto:${settings.contact_email}">Email me</a>` : ''}
    ${socialRow(links, 'on-about')}
  </p>` : ''}
</article></main>`;
  return shell(req, settings, {
    meta: { title: 'About', description: paragraphs[0]?.slice(0, 160) || settings.tagline, url: `${baseUrl(req)}/about` },
    active: 'about', body,
  });
}

export function errorView(req, { settings, status, message }) {
  const body = html`
<main class="wrap"><article class="page single prose center">
  <span class="bar" aria-hidden="true"></span>
  <h1>${status}</h1>
  <p>${message}</p>
  <p><a class="btn" href="/">Back to the book</a></p>
</article></main>`;
  return shell(req, settings, { meta: { title: String(status) }, body });
}
