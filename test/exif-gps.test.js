import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import exifr from 'exifr';
import { stripGpsJpeg } from '../src/exif-gps.js';

async function jpegWithGps() {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: '#a64' } })
    .withExif({
      IFD0: { Make: 'TestCam', Model: 'T-1000' },
      IFD3: {
        GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1',
        GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1',
      },
    })
    .jpeg().toBuffer();
}

test('stripGpsJpeg removes GPS but keeps camera Exif and pixels', async () => {
  const input = await jpegWithGps();
  const before = await exifr.gps(input);
  assert.ok(before && Math.abs(before.latitude - 51.5) < 0.01, 'fixture should contain GPS');

  const { buffer, stripped } = stripGpsJpeg(input);
  assert.equal(stripped, true);
  assert.equal(buffer.length, input.length);
  assert.equal(await exifr.gps(buffer).catch(() => undefined), undefined);

  const meta = await exifr.parse(buffer, ['Make', 'Model']);
  assert.equal(meta.Make, 'TestCam');
  assert.equal(meta.Model, 'T-1000');

  const [a, b] = await Promise.all([input, buffer].map((x) => sharp(x).raw().toBuffer()));
  assert.ok(a.equals(b), 'pixels must be identical');
});

test('stripGpsJpeg leaves non-JPEG and GPS-free files alone', async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal(stripGpsJpeg(png).stripped, false);
  const plain = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  assert.equal(stripGpsJpeg(plain).stripped, false);
});

test('stripGpsJpeg survives truncated input', () => {
  assert.doesNotThrow(() => stripGpsJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00])));
});
