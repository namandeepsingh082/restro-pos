/**
 * Generates the PWA icons as real PNG files with no image library — the app
 * ships with icons out of the box so the install prompt works on Android.
 * Run: node scripts/make-icons.mjs
 * Replace public/icons/*.png with your own logo whenever you like.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const TEAL = [14, 92, 99];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A receipt-slip glyph: white paper with a torn bottom edge on teal. */
function pixel(x, y, size, maskable) {
  const pad = maskable ? size * 0.22 : size * 0.16;
  const w = size - pad * 2;
  const h = w * 1.18;
  const top = (size - h) / 2;
  const inX = x >= pad && x <= pad + w;
  if (!inX || y < top || y > top + h) return TEAL;

  // torn zig-zag bottom
  const bottomBand = top + h - w * 0.1;
  if (y > bottomBand) {
    const period = w / 6;
    const phase = ((x - pad) % period) / period;
    const depth = Math.abs(phase - 0.5) * 2 * (w * 0.1);
    if (y > bottomBand + depth) return TEAL;
  }

  // printed lines
  const lineTop = top + h * 0.2;
  const gap = h * 0.13;
  for (let i = 0; i < 4; i++) {
    const ly = lineTop + i * gap;
    if (y >= ly && y < ly + Math.max(2, size * 0.022)) {
      const lineW = i === 0 ? w * 0.62 : w * (0.78 - i * 0.06);
      if (x >= pad + w * 0.12 && x <= pad + w * 0.12 + lineW) return TEAL;
    }
  }
  return WHITE;
}

function png(size, maskable) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y, size, maskable);
      raw[p++] = r; raw[p++] = g; raw[p++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, false));
writeFileSync('public/icons/icon-512.png', png(512, false));
writeFileSync('public/icons/maskable-512.png', png(512, true));
writeFileSync('public/icons/apple-touch-icon.png', png(180, true));
console.log('Wrote public/icons/*.png');
