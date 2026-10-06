import fs from 'node:fs';
import fsp from 'node:fs/promises';
import sharp from 'sharp';
import exifr from 'exifr';
import { MAX_UPLOAD_BYTES } from './config.js';
import { db, getSetting } from './db.js';
import { stripGpsJpeg } from './exif-gps.js';
import { ensureCover, originalPath, derivedDir, derivedPath } from './store.js';

sharp.cache(false);
sharp.concurrency(1);

const FORMATS = { jpeg: 'jpg', png: 'png', webp: 'webp', tiff: 'tiff' };
const MAX_PIXELS = 150e6;

export const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', tiff: 'image/tiff' };

const fmtShutter = (t) => (t >= 1 ? `${+t.toFixed(1)}s` : `1/${Math.round(1 / t)}s`);

async function readExif(source) {
  try {
    const x = await exifr.parse(source, {
      pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal'],
    });
    if (!x) return { exif: {}, taken: null };
    // "NIKON CORPORATION" + "NIKON D300S" → "NIKON D300S"; "Canon" + "Canon EOS R6" → "Canon EOS R6"
    const make = String(x.Make || '').trim(), model = String(x.Model || '').trim();
    const camera = model && make && !model.toLowerCase().startsWith(make.split(' ')[0].toLowerCase()) ? `${make} ${model}` : (model || make);
    const exif = {};
    if (camera) exif.camera = camera;
    if (x.LensModel) exif.lens = String(x.LensModel);
    if (x.FocalLength) exif.focal = `${Math.round(x.FocalLength)}mm`;
    if (x.FNumber) exif.aperture = `f/${+Number(x.FNumber).toFixed(1)}`;
    if (x.ExposureTime) exif.shutter = fmtShutter(x.ExposureTime);
    if (x.ISO) exif.iso = Number(x.ISO);
    const taken = x.DateTimeOriginal instanceof Date && !Number.isNaN(+x.DateTimeOriginal)
      ? x.DateTimeOriginal.toISOString() : null;
    return { exif, taken };
  } catch {
    return { exif: {}, taken: null };
  }
}

/**
 * Validate, strip GPS, store the original and build thumb/display derivatives for an
 * already-inserted photo row. `tmpPath` is consumed (moved or deleted).
 */
export async function processPhoto(photoId, tmpPath) {
  try {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
    if (!photo) return;

    const { size } = await fsp.stat(tmpPath);
    if (size > MAX_UPLOAD_BYTES) throw new Error(`File is larger than ${MAX_UPLOAD_BYTES / 1048576} MB`);

    const meta = await sharp(tmpPath, { limitInputPixels: MAX_PIXELS }).metadata();
    let ext = FORMATS[meta.format];
    if (meta.format === 'heif') {
      if (meta.compression === 'av1') ext = 'avif';
      else throw new Error('HEIC/HEIF is not supported. Export the photo as JPEG and upload that.');
    }
    if (!ext) throw new Error(`Unsupported image type${meta.format ? ` (${meta.format})` : ''}`);

    let exifSource = tmpPath;
    if (ext === 'jpg' && getSetting('strip_gps') === '1') {
      const { buffer, stripped } = stripGpsJpeg(await fsp.readFile(tmpPath));
      exifSource = buffer;
      if (stripped) {
        await fsp.writeFile(tmpPath, buffer);
      }
    }
    const { exif, taken } = await readExif(exifSource);
    exifSource = null;

    const oriented = meta.autoOrient
      ? { w: meta.autoOrient.width, h: meta.autoOrient.height }
      : (meta.orientation || 1) >= 5 ? { w: meta.height, h: meta.width } : { w: meta.width, h: meta.height };

    // Write derivatives into a fresh dir name first so a failure leaves any previous version intact.
    const dir = derivedDir(photoId);
    await fsp.mkdir(dir, { recursive: true });
    const displayFile = derivedPath(photoId, 'display.webp');
    const thumbFile = derivedPath(photoId, 'thumb.webp');
    await sharp(tmpPath, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toFile(displayFile);
    await sharp(displayFile)
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76 })
      .toFile(thumbFile);
    await fsp.rm(derivedPath(photoId, 'og.jpg'), { force: true }); // regenerate lazily

    const px = await sharp(thumbFile).resize(1, 1, { fit: 'cover' }).removeAlpha().raw().toBuffer();
    const color = '#' + [...px.subarray(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('');

    // Move the original into place (remove an older original with a different extension).
    const dest = originalPath(photoId, ext);
    if (photo.ext !== ext) await fsp.rm(originalPath(photoId, photo.ext), { force: true });
    await fsp.rename(tmpPath, dest);

    db.prepare(`UPDATE photos SET status='ready', error='', ext=?, width=?, height=?, bytes=?, taken_at=CASE WHEN source = 'icloud' AND taken_at IS NOT NULL THEN taken_at ELSE COALESCE(?, taken_at) END, exif=?,
      color=?, version=version+1 WHERE id=?`)
      .run(ext, oriented.w, oriented.h, (await fsp.stat(dest)).size, taken, JSON.stringify(exif), color, photoId);
    ensureCover(photo.album_id);
  } catch (err) {
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    db.prepare("UPDATE photos SET status='error', error=? WHERE id=?").run(String(err.message || err).slice(0, 300), photoId);
    console.error(`[images] photo ${photoId}:`, err.message || err);
  }
}

// ---- lazily generated social-preview image (JPEG: WhatsApp/iMessage dislike webp) ----
const ogInflight = new Map();
export async function ensureOg(photoId) {
  const out = derivedPath(photoId, 'og.jpg');
  if (fs.existsSync(out)) return out;
  if (!ogInflight.has(photoId)) {
    const job = sharp(derivedPath(photoId, 'display.webp'))
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: false })
      .toFile(out + '.part')
      .then(() => fsp.rename(out + '.part', out))
      .finally(() => ogInflight.delete(photoId));
    ogInflight.set(photoId, job);
  }
  await ogInflight.get(photoId);
  return out;
}
