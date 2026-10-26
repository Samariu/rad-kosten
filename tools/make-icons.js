#!/usr/bin/env node
// Generates the PWA PNG icons with no dependencies: the bicycle glyph is drawn
// from signed-distance primitives, supersampled for antialiasing, and encoded
// as PNG using Node's built-in zlib. Run `node tools/make-icons.js` after
// changing the artwork; the output is committed.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const BG = [0x2a, 0x78, 0xd6];
const FG = [0xff, 0xff, 0xff];

/* ------------------------------------------------------------- geometry -- */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Distance to a thick line segment (a capsule). */
const capsule = (p, a, b, w) => {
  const pa = sub(p, a), ba = sub(b, a);
  const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
  return len([pa[0] - ba[0] * h, pa[1] - ba[1] * h]) - w / 2;
};

/** Distance to a ring (a stroked circle). */
const ring = (p, c, r, w) => Math.abs(len(sub(p, c)) - r) - w / 2;

const disc = (p, c, r) => len(sub(p, c)) - r;

/** Distance to a rounded rectangle centred on (cx, cy). */
const roundRect = (p, cx, cy, hw, hh, r) => {
  const qx = Math.abs(p[0] - cx) - (hw - r);
  const qy = Math.abs(p[1] - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

// The bicycle, in a normalised 0..1 glyph box.
const W = 0.052;                       // stroke weight
const REAR = [0.215, 0.70], FRONT = [0.785, 0.70];
const CRANK = [0.495, 0.70];
const SEAT_TOP = [0.415, 0.395], HEAD = [0.665, 0.415], HEAD_TOP = [0.685, 0.345];

function bikeDistance(p) {
  return Math.min(
    ring(p, REAR, 0.205, W),
    ring(p, FRONT, 0.205, W),
    disc(p, CRANK, 0.042),
    capsule(p, CRANK, SEAT_TOP, W * 0.85),      // seat tube
    capsule(p, CRANK, HEAD, W * 0.85),          // down tube
    capsule(p, SEAT_TOP, HEAD, W * 0.85),       // top tube
    capsule(p, REAR, CRANK, W * 0.85),          // chain stay
    capsule(p, REAR, SEAT_TOP, W * 0.85),       // seat stay
    capsule(p, HEAD, FRONT, W * 0.85),          // fork
    capsule(p, HEAD, HEAD_TOP, W * 0.85),       // head tube
    capsule(p, [0.615, 0.325], [0.735, 0.325], W * 0.8),  // handlebar
    capsule(p, [0.335, 0.352], [0.462, 0.352], W * 0.95)  // saddle
  );
}

/* --------------------------------------------------------------- raster -- */

const SS = 4; // supersampling factor per axis

function render(size, { maskable }) {
  // A maskable icon must survive an aggressive circular crop, so the glyph sits
  // inside the 80% safe zone and the background bleeds to the edges.
  const glyphScale = maskable ? 0.60 : 0.78;
  const px = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCov = 0, fgCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;

          const inBg = maskable
            ? true
            : roundRect([u, v], 0.5, 0.5, 0.5, 0.5, 0.225) <= 0;
          if (inBg) bgCov++;

          // Map the pixel into the glyph box, centred.
          const g = [(u - 0.5) / glyphScale + 0.5, (v - 0.5) / glyphScale + 0.5];
          if (inBg && bikeDistance(g) <= 0) fgCov++;
        }
      }
      const n = SS * SS;
      const a = bgCov / n;
      const f = fgCov / n;
      const i = (y * size + x) * 4;
      // Composite the white glyph over the blue plate, then premultiply by the
      // plate's own coverage so the rounded corners stay smooth.
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round(BG[c] * (1 - f / Math.max(a, 1e-6)) + FG[c] * (f / Math.max(a, 1e-6)));
      }
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

/* ------------------------------------------------------------------ PNG -- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- SVG twin -- */

function svg() {
  const line = (a, b, w) =>
    `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke-width="${w}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="512" height="512">
  <rect width="1" height="1" rx=".225" fill="#2a78d6"/>
  <g transform="translate(.5 .5) scale(.78) translate(-.5 -.5)"
     fill="none" stroke="#fff" stroke-linecap="round" stroke-width="${W * 0.85}">
    <circle cx="${REAR[0]}" cy="${REAR[1]}" r=".205" stroke-width="${W}"/>
    <circle cx="${FRONT[0]}" cy="${FRONT[1]}" r=".205" stroke-width="${W}"/>
    <circle cx="${CRANK[0]}" cy="${CRANK[1]}" r=".042" fill="#fff" stroke="none"/>
    ${line(CRANK, SEAT_TOP, W * 0.85)}
    ${line(CRANK, HEAD, W * 0.85)}
    ${line(SEAT_TOP, HEAD, W * 0.85)}
    ${line(REAR, CRANK, W * 0.85)}
    ${line(REAR, SEAT_TOP, W * 0.85)}
    ${line(HEAD, FRONT, W * 0.85)}
    ${line(HEAD, HEAD_TOP, W * 0.85)}
    ${line([0.615, 0.325], [0.735, 0.325], W * 0.8)}
    ${line([0.335, 0.352], [0.462, 0.352], W * 0.95)}
  </g>
</svg>\n`;
}

/* ----------------------------------------------------------------- main -- */

mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
];
for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT, name), encodePNG(size, render(size, opts)));
  console.log(`wrote icons/${name} (${size}×${size})`);
}
writeFileSync(join(OUT, 'icon.svg'), svg());
console.log('wrote icons/icon.svg');
