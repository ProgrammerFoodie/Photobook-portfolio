import sharp from 'sharp';

/** Generate a JPEG with camera Exif (and optionally GPS) for tests. */
export async function makeJpeg(width, height, color = '#E37C44', { gps = true } = {}) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#1a0d06"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width * 0.6}" cy="${height * 0.5}" r="${Math.min(width, height) * 0.25}" fill="#f6ebe1" opacity="0.8"/></svg>`;
  const exif = {
    IFD0: { Make: 'Canon', Model: 'Canon EOS R6' },
    IFD2: { ExposureTime: '1/500', FNumber: '28/10', ISOSpeedRatings: '200', FocalLength: '85/1', LensModel: 'RF85mm F2 MACRO IS STM', DateTimeOriginal: '2026:09:12 14:03:22' },
  };
  if (gps) exif.IFD3 = { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' };
  return sharp(Buffer.from(svg)).withExif(exif).jpeg({ quality: 90 }).toBuffer();
}
