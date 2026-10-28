#!/usr/bin/env node
// Writes media/icon.png - the Marketplace tile and the editor-tab icon.
// Hand-rasterised rather than pulled from a design tool so the build has no
// binary asset to keep in sync: it is the same ">_" mark as the website's
// favicon, in the same colours.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const BG = [0x0a, 0x25, 0x40]; // same navy as the site
const FG = [0xe8, 0x5d, 0x26]; // same terminal orange
const RADIUS = 24;

const px = Buffer.alloc(SIZE * SIZE * 4);

function set(x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const src = a === undefined ? 1 : a;
  if (src <= 0) return;
  // Straight "over" blend so the antialiased edges sit on what's underneath.
  const dr = px[i], dg = px[i + 1], db = px[i + 2], da = px[i + 3] / 255;
  const outA = src + da * (1 - src);
  px[i] = Math.round((r * src + dr * da * (1 - src)) / outA);
  px[i + 1] = Math.round((g * src + dg * da * (1 - src)) / outA);
  px[i + 2] = Math.round((b * src + db * da * (1 - src)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

// Coverage of a rounded rectangle, sampled 3x3 per pixel for a soft edge.
function roundedCoverage(x, y) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const fx = x + (sx + 0.5) / 3;
      const fy = y + (sy + 0.5) / 3;
      const cx = Math.min(Math.max(fx, RADIUS), SIZE - RADIUS);
      const cy = Math.min(Math.max(fy, RADIUS), SIZE - RADIUS);
      if (Math.hypot(fx - cx, fy - cy) <= RADIUS) hits++;
    }
  }
  return hits / 9;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const c = roundedCoverage(x, y);
    if (c > 0) set(x, y, BG, c);
  }
}

// Distance from a point to a line segment, for stroking the glyph.
function stroke(x0, y0, x1, y1, width) {
  const half = width / 2;
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let hits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const fx = x + (sx + 0.5) / 3;
          const fy = y + (sy + 0.5) / 3;
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len2 = dx * dx + dy * dy;
          let t = len2 === 0 ? 0 : ((fx - x0) * dx + (fy - y0) * dy) / len2;
          t = Math.min(Math.max(t, 0), 1);
          if (Math.hypot(fx - (x0 + t * dx), fy - (y0 + t * dy)) <= half) hits++;
        }
      }
      if (hits) set(x, y, FG, hits / 9);
    }
  }
}

// ">" chevron, then the "_" cursor bar beside it.
stroke(38, 40, 64, 64, 11);
stroke(64, 64, 38, 88, 11);
stroke(76, 88, 98, 88, 11);

// ---------- PNG container ----------

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Each scanline is prefixed with its filter type; 0 = none.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.resolve(__dirname, '..', 'media', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote media/icon.png — ${SIZE}x${SIZE}, ${png.length} bytes`);
