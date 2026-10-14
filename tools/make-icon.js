'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const SS = 3;
const W = SIZE * SS;

const buf = Buffer.alloc(W * W * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  const sa = a / 255;
  const da = buf[i + 3] / 255;
  if (sa === 0) return;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / oa);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
  buf[i + 3] = Math.round(oa * 255);
}

function fillCircle(cx, cy, r, c, alpha = 255) {
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) blend(x, y, c[0], c[1], c[2], alpha);
    }
  }
}

function fillTriangle(p, q, s, c, alpha = 255) {
  const minX = Math.floor(Math.min(p[0], q[0], s[0]));
  const maxX = Math.ceil(Math.max(p[0], q[0], s[0]));
  const minY = Math.floor(Math.min(p[1], q[1], s[1]));
  const maxY = Math.ceil(Math.max(p[1], q[1], s[1]));
  const sign = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d = sign(p, q, s);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = sign(p, q, [px, py]);
      const w2 = sign(q, s, [px, py]);
      const w3 = sign(s, p, [px, py]);
      const neg = w1 <= 0 && w2 <= 0 && w3 <= 0;
      const pos = w1 >= 0 && w2 >= 0 && w3 >= 0;
      if (neg || pos) blend(x, y, c[0], c[1], c[2], alpha);
    }
  }
}

function fillArc(cx, cy, r, fromDeg, toDeg, thick, c, alpha = 255) {
  const r0 = r - thick / 2, r1 = r + thick / 2;
  for (let deg = fromDeg; deg <= toDeg; deg += 0.35) {
    const rad = (deg * Math.PI) / 180;
    fillCircle(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r, thick / 2, c, alpha);
  }
}

const GREEN = [0xA9, 0xD6, 0xC2];
const GREEN_DK = [0x93, 0xC4, 0xAB];
const CREAM = [0xFF, 0xFC, 0xF5];
const OUTLINE = [0xE4, 0xDA, 0xC8];
const INK = [0x4A, 0x48, 0x44];
const BLUSH = [0xF3, 0xC0, 0xCA];

const C = W / 2;

fillCircle(C, C, C - 2 * SS, GREEN);
fillCircle(C, C, C - 2 * SS, GREEN_DK, 90);

const headR = 68 * SS;
const headY = (140) * SS;
fillCircle(128 * SS, headY, headR + 2 * SS, OUTLINE);
fillCircle(128 * SS, headY, headR, CREAM);

fillTriangle([74 * SS, 100 * SS], [92 * SS, 34 * SS], [126 * SS, 68 * SS], OUTLINE);
fillTriangle([77 * SS, 97 * SS], [94 * SS, 44 * SS], [123 * SS, 71 * SS], CREAM);
fillTriangle([182 * SS, 100 * SS], [164 * SS, 34 * SS], [130 * SS, 68 * SS], OUTLINE);
fillTriangle([179 * SS, 97 * SS], [162 * SS, 44 * SS], [133 * SS, 71 * SS], CREAM);

fillArc(106 * SS, 140 * SS, 7 * SS, 200, 340, 3 * SS, INK);
fillArc(150 * SS, 140 * SS, 7 * SS, 200, 340, 3 * SS, INK);

fillCircle(104 * SS, 137 * SS, 1.6 * SS, [0xFF, 0xFF, 0xFF], 255);
fillCircle(148 * SS, 137 * SS, 1.6 * SS, [0xFF, 0xFF, 0xFF], 255);

fillArc(128 * SS, 158 * SS, 15 * SS, 25, 155, 3 * SS, INK);

fillCircle(88 * SS, 160 * SS, 9 * SS, BLUSH, 150);
fillCircle(168 * SS, 160 * SS, 9 * SS, BLUSH, 150);

const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * W + (x * SS + dx)) * 4;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3];
      }
    }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
    out[o + 3] = Math.round(a / n);
  }
}

function crc32(data) {
  return zlib.crc32 ? zlib.crc32(data) : require('zlib').crc32(data);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function encodeICO(png) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = SIZE >= 256 ? 0 : SIZE;
  entry[1] = SIZE >= 256 ? 0 : SIZE;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32BE(png.length, 8);
  entry.writeUInt32BE(22, 12);
  return Buffer.concat([dir, entry, png]);
}

const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });
const png = encodePNG(SIZE, SIZE, out);
fs.writeFileSync(path.join(buildDir, 'icon.png'), png);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), encodeICO(png));
console.log(`icon written: ${png.length} bytes -> build/icon.png, build/icon.ico`);
