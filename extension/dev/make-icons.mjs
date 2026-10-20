// Fabrique les icônes PNG de l'extension, sans dépendance (zlib de Node).
// Un carré arrondi violet et deux maillons blancs (« Connect »).
// Usage : node extension/dev/make-icons.mjs   (écrit extension/icons/*.png)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(out, { recursive: true });

const BG = [0x91, 0x47, 0xff];
const FG = [0xff, 0xff, 0xff];

function roundBox(x, y, half, r) {
  const qx = Math.abs(x) - (half - r);
  const qy = Math.abs(y) - (half - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

function capsule(x, y, ax, bx, r) {
  const t = Math.max(ax, Math.min(bx, x));
  return Math.hypot(x - t, y) - r;
}

// Couverture (0..1) du fond et du dessin au point (u, v) de [0, 1]².
function sample(u, v, size) {
  const x = u - 0.5;
  const y = v - 0.5;
  const bg = roundBox(x, y, 0.47, 0.2) < 0 ? 1 : 0;
  // Repère tourné de 45° : les maillons suivent la diagonale.
  const c = Math.SQRT1_2;
  const rx = (x - y) * c;
  const ry = (x + y) * c;
  const w = size <= 16 ? 0.062 : size <= 32 ? 0.052 : 0.045;
  const a = Math.abs(capsule(rx, ry, -0.2, -0.03, 0.115)) - w;
  const b = Math.abs(capsule(rx, ry, 0.03, 0.2, 0.115)) - w;
  return { bg, fg: bg && (a < 0 || b < 0) ? 1 : 0 };
}

function render(size) {
  const ss = 6;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let bg = 0;
      let fg = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const s = sample((i + (si + 0.5) / ss) / size, (j + (sj + 0.5) / ss) / size, size);
          bg += s.bg;
          fg += s.fg;
        }
      }
      bg /= ss * ss;
      fg /= ss * ss;
      const mix = bg > 0 ? fg / bg : 0;
      const o = (j * size + i) * 4;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(BG[k] * (1 - mix) + FG[k] * mix);
      px[o + 3] = Math.round(bg * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // 8 bits par canal
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) {
    raw[j * (size * 4 + 1)] = 0; // pas de filtre
    rgba.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

for (const size of [16, 32, 48, 128]) {
  const file = join(out, "icon-" + size + ".png");
  writeFileSync(file, png(size, render(size)));
  console.log("écrit", file);
}
