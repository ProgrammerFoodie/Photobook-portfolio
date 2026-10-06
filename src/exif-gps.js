/**
 * Remove GPS location data from a JPEG without re-encoding the pixels.
 *  - GPS IFD inside the Exif APP1 segment is emptied (values zeroed, entry count set to 0)
 *  - XMP APP1 segments that mention GPS are dropped
 * Camera make/model/lens/exposure Exif is kept. Returns { buffer, stripped }.
 */
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');
const XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');

function wipeGpsInTiff(buf, tiff, end) {
  // returns true if a GPS IFD was found and cleared
  if (tiff + 8 > end) return false;
  const little = buf.toString('latin1', tiff, tiff + 2) === 'II';
  if (!little && buf.toString('latin1', tiff, tiff + 2) !== 'MM') return false;
  const u16 = (o) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const inRange = (o, len) => o >= tiff && o + len <= end;

  const ifd0 = tiff + u32(tiff + 4);
  if (!inRange(ifd0, 2)) return false;
  const n0 = u16(ifd0);
  if (!inRange(ifd0 + 2, n0 * 12)) return false;

  let found = false;
  for (let i = 0; i < n0; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (u16(entry) !== 0x8825) continue; // GPSInfo pointer
    const gps = tiff + u32(entry + 8);
    if (!inRange(gps, 2)) continue;
    const n = u16(gps);
    if (!inRange(gps + 2, n * 12 + 4)) continue;
    for (let j = 0; j < n; j++) {
      const e = gps + 2 + j * 12;
      const size = (TYPE_SIZE[u16(e + 2)] || 1) * u32(e + 4);
      if (size > 4) {
        const off = tiff + u32(e + 8);
        if (inRange(off, size)) buf.fill(0, off, off + size);
      }
    }
    buf.fill(0, gps, gps + 2 + n * 12 + 4); // count, entries and next-IFD pointer → empty IFD
    found = true;
  }
  return found;
}

export function stripGpsJpeg(input) {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return { buffer: input, stripped: false };
  const buf = Buffer.from(input); // work on a copy
  const keep = []; // [start, end) ranges to keep
  let stripped = false;
  let pos = 2;
  let copyFrom = 0;

  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) break;
    const marker = buf[pos + 1];
    if (marker === 0xff) { pos++; continue; }               // fill byte
    if (marker === 0xda || marker === 0xd9) break;           // SOS / EOI: entropy data follows
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { pos += 2; continue; } // standalone
    const len = buf.readUInt16BE(pos + 2);
    const segEnd = pos + 2 + len;
    if (len < 2 || segEnd > buf.length) break;

    if (marker === 0xe1) {
      const dataStart = pos + 4;
      if (buf.subarray(dataStart, dataStart + 6).equals(EXIF_HEADER)) {
        if (wipeGpsInTiff(buf, dataStart + 6, segEnd)) stripped = true;
      } else if (buf.subarray(dataStart, dataStart + XMP_HEADER.length).equals(XMP_HEADER)
        && buf.toString('latin1', dataStart, segEnd).includes('GPS')) {
        keep.push([copyFrom, pos]);
        copyFrom = segEnd;
        stripped = true;
      }
    }
    pos = segEnd;
  }

  if (copyFrom === 0) return { buffer: buf, stripped };
  keep.push([copyFrom, buf.length]);
  return { buffer: Buffer.concat(keep.map(([a, b]) => buf.subarray(a, b))), stripped };
}
