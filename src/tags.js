/** Photo tags ("BMW M3", "#42", a plate…) and the search/filter used by album pages, zips and /search. */
import { db, tx } from './db.js';

export const MAX_TAG_LEN = 40;
export const MAX_TAGS_PER_PHOTO = 12;

/** Case/accent-insensitive, unicode-aware key: "BMW M3" → "bmw-m3", "Rīga" → "riga", "БМВ М3" → "бмв-м3". */
export function tagSlug(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
export const cleanTagName = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LEN);

/** "BMW M3, #42\nblue" or ['BMW M3'] → unique cleaned names (max 12). */
export function parseTagList(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,;\n]+/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const name = cleanTagName(item);
    const slug = tagSlug(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(name);
  }
  return out.slice(0, MAX_TAGS_PER_PHOTO);
}

function tagId(name) {
  const slug = tagSlug(name);
  const row = db.prepare('SELECT id FROM tags WHERE slug = ?').get(slug);
  if (row) return row.id;
  return Number(db.prepare('INSERT INTO tags (name, slug) VALUES (?, ?)').run(name, slug).lastInsertRowid);
}

export function pruneTags() {
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags)').run();
}

/** Add tags to many photos. Returns { added, skipped } (skipped = photos already at the per-photo limit). */
export function addTags(photoIds, names) {
  let added = 0, skipped = 0;
  tx(() => {
    const ids = names.map(tagId);
    const count = db.prepare('SELECT COUNT(*) AS n FROM photo_tags WHERE photo_id = ?');
    const has = db.prepare('SELECT 1 FROM photo_tags WHERE photo_id = ? AND tag_id = ?');
    const insert = db.prepare('INSERT INTO photo_tags (photo_id, tag_id) VALUES (?, ?)');
    for (const photoId of photoIds) {
      let full = false;
      for (const id of ids) {
        if (has.get(photoId, id)) continue;
        if (count.get(photoId).n >= MAX_TAGS_PER_PHOTO) { full = true; break; }
        insert.run(photoId, id);
        added++;
      }
      if (full) skipped++;
    }
  });
  return { added, skipped };
}

export function removeTags(photoIds, names) {
  const slugs = names.map(tagSlug).filter(Boolean);
  if (!slugs.length || !photoIds.length) return;
  tx(() => {
    const del = db.prepare('DELETE FROM photo_tags WHERE photo_id = ? AND tag_id IN (SELECT id FROM tags WHERE slug = ?)');
    for (const photoId of photoIds) for (const slug of slugs) del.run(photoId, slug);
    pruneTags();
  });
}

/** Map(photoId → [{ name, slug }]) */
export function tagsForPhotos(photoIds) {
  const map = new Map(photoIds.map((id) => [id, []]));
  if (!photoIds.length) return map;
  const rows = db.prepare(`SELECT pt.photo_id, t.name, t.slug FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
    WHERE pt.photo_id IN (${photoIds.map(() => '?').join(',')}) ORDER BY t.name COLLATE NOCASE`).all(...photoIds);
  for (const r of rows) map.get(r.photo_id)?.push({ name: r.name, slug: r.slug });
  return map;
}

/** Tags used by the public photos of an album, most used first. */
export function albumTagCounts(albumId) {
  return db.prepare(`SELECT t.name, t.slug, COUNT(*) AS n FROM photo_tags pt
    JOIN tags t ON t.id = pt.tag_id JOIN photos p ON p.id = pt.photo_id
    WHERE p.album_id = ? AND p.status = 'ready' AND p.is_hidden = 0
    GROUP BY t.id ORDER BY n DESC, t.name COLLATE NOCASE`).all(albumId);
}

/** Most used tags across the public site (for search suggestions). */
export function siteTagSuggestions(limit = 60) {
  return db.prepare(`SELECT t.name, COUNT(DISTINCT p.id) AS n FROM tags t
    JOIN photo_tags pt ON pt.tag_id = t.id JOIN photos p ON p.id = pt.photo_id JOIN albums a ON a.id = p.album_id
    WHERE a.is_published = 1 AND p.status = 'ready' AND p.is_hidden = 0
    GROUP BY t.id ORDER BY n DESC, t.name COLLATE NOCASE LIMIT ?`).all(limit);
}

export function tagNameBySlug(slug) {
  return db.prepare('SELECT name FROM tags WHERE slug = ?').get(slug)?.name ?? null;
}

/** Every tag with usage numbers (admin). */
export function allTags() {
  return db.prepare(`SELECT t.id, t.name, t.slug, COUNT(pt.photo_id) AS photos, COUNT(DISTINCT p.album_id) AS albums
    FROM tags t LEFT JOIN photo_tags pt ON pt.tag_id = t.id LEFT JOIN photos p ON p.id = pt.photo_id
    GROUP BY t.id ORDER BY t.name COLLATE NOCASE`).all();
}

/** Rename; if another tag already has the new name, merge into it. Returns the surviving tag id, or 0 if invalid. */
export function renameTag(id, newName) {
  const name = cleanTagName(newName);
  const slug = tagSlug(name);
  if (!slug) return 0;
  return tx(() => {
    const other = db.prepare('SELECT id FROM tags WHERE slug = ? AND id != ?').get(slug, id);
    if (!other) { db.prepare('UPDATE tags SET name = ?, slug = ? WHERE id = ?').run(name, slug, id); return id; }
    db.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) SELECT photo_id, ? FROM photo_tags WHERE tag_id = ?').run(other.id, id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    return other.id;
  });
}
export const deleteTag = (id) => db.prepare('DELETE FROM tags WHERE id = ?').run(id).changes > 0;

// ---------- filtering ----------
const escLike = (v) => v.replace(/[\\%_]/g, '\\$&');
const TAG_EXISTS = 'EXISTS (SELECT 1 FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.photo_id = p.id AND ';

/**
 * SQL fragment (+args) restricting photos (alias `p`) to an exact tag and/or a free-text search.
 * Every word of the search must match the start of a word in a tag, or appear in the caption,
 * so "blue m3" finds a photo tagged "blue" and "BMW M3", and "bm" finds "BMW M3" (search as you type).
 */
export function photoFilter({ tag = '', q = '' } = {}) {
  const parts = [];
  const args = [];
  if (tag) { parts.push(`${TAG_EXISTS}t.slug = ?)`); args.push(tag); }
  const words = String(q).trim().slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 5);
  for (const word of words) {
    const slug = tagSlug(word);
    const alts = [];
    if (slug) {
      alts.push(`${TAG_EXISTS}(t.slug LIKE ? ESCAPE '\\' OR t.slug LIKE ? ESCAPE '\\'))`);
      args.push(`${escLike(slug)}%`, `%-${escLike(slug)}%`);
    }
    alts.push("p.caption LIKE ? ESCAPE '\\'");
    args.push(`%${escLike(word)}%`);
    parts.push(`(${alts.join(' OR ')})`);
  }
  return { sql: parts.map((x) => ` AND ${x}`).join(''), args };
}
