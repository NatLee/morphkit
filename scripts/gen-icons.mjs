// Generates MorphKit PWA icons (PNG) from the brand mark, no native deps —
// rasterizes the favicon's chamfered square + neon "M" polyline with a 2x
// supersample, encodes via the project's upng-js.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT = process.cwd();
const require = createRequire(join(PROJECT, 'package.json'));
const UPNG = require('upng-js');

const OUT = join(PROJECT, 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// Brand geometry in 32-unit favicon space
const SEGS = [
  [10, 21, 10, 11],
  [10, 11, 16, 17],
  [16, 17, 22, 11],
  [22, 11, 22, 21],
];
const BG = [10, 14, 28]; // #0a0e1c
const CYAN = [0x38, 0xdf, 0xff];
const PINK = [0xff, 0x5c, 0x8a];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  const ex = x1 + t * dx - px, ey = y1 + t * dy - py;
  return Math.hypot(ex, ey);
}

/**
 * @param size    output px
 * @param chamfer true = favicon-style cut-corner tile w/ transparent corners;
 *                false = full-bleed square (maskable / apple-touch)
 * @param glyphScale shrink glyph around center (maskable safe zone)
 */
function renderIcon(size, chamfer, glyphScale = 1) {
  const SS = 2; // supersample
  const S = size * SS;
  const k = S / 32;
  const img = new Uint8Array(S * S * 4);
  const cx = 16, cy = 16;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // unit-space coords (favicon 32-grid)
      const ux = (x + 0.5) / k;
      const uy = (y + 0.5) / k;

      // tile shape alpha
      let shapeA = 1;
      if (chamfer) {
        // square (1,1)-(31,31) with 5-unit 45° cut corners; signed inner distance
        const d = Math.min(
          ux - 1, 31 - ux, uy - 1, 31 - uy,
          (ux + uy - 6) / Math.SQRT2,
          (31 - ux + uy - 5) / Math.SQRT2,
          (ux + 31 - uy - 5) / Math.SQRT2,
          (31 - ux + 31 - uy - 4) / Math.SQRT2,
        );
        shapeA = clamp(d * k + 0.5, 0, 1);
      }
      if (shapeA <= 0) continue;

      // glyph coords (optionally scaled toward center for maskable safe zone)
      const gx = cx + (ux - cx) / glyphScale;
      const gy = cy + (uy - cy) / glyphScale;
      let dMin = Infinity;
      for (const [x1, y1, x2, y2] of SEGS) {
        const d = distSeg(gx, gy, x1, y1, x2, y2);
        if (d < dMin) dMin = d;
      }
      const dPx = dMin * k * glyphScale;
      const halfW = 1.3 * k * glyphScale;
      const coreA = clamp(halfW + 0.5 - dPx, 0, 1);
      const glowW = 4.2 * k * glyphScale;
      const glowA = Math.pow(clamp(1 - dPx / glowW, 0, 1), 2) * 0.38;

      // gradient along the glyph bbox diagonal
      const t = clamp(((gx - 10) / 12 + (gy - 11) / 10) / 2, 0, 1);
      const gr = CYAN[0] + (PINK[0] - CYAN[0]) * t;
      const gg = CYAN[1] + (PINK[1] - CYAN[1]) * t;
      const gb = CYAN[2] + (PINK[2] - CYAN[2]) * t;

      // composite: bg → glow → core
      let r = BG[0], g = BG[1], b = BG[2];
      r += (gr - r) * glowA; g += (gg - g) * glowA; b += (gb - b) * glowA;
      r += (gr - r) * coreA; g += (gg - g) * coreA; b += (gb - b) * coreA;

      const i = (y * S + x) * 4;
      img[i] = Math.round(r);
      img[i + 1] = Math.round(g);
      img[i + 2] = Math.round(b);
      img[i + 3] = Math.round(shapeA * 255);
    }
  }

  // box-downsample SS×SS → size
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + x * SS + sx) * 4;
          const w = img[i + 3] / 255;
          r += img[i] * w; g += img[i + 1] * w; b += img[i + 2] * w; a += img[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const aw = a / 255 || 1;
      out[o] = Math.round(r / aw);
      out[o + 1] = Math.round(g / aw);
      out[o + 2] = Math.round(b / aw);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

function save(name, size, chamfer, glyphScale) {
  const rgba = renderIcon(size, chamfer, glyphScale);
  const png = UPNG.encode([rgba.buffer], size, size, 0);
  writeFileSync(join(OUT, name), Buffer.from(png));
  console.log('wrote', name, `${size}px`, `${Buffer.from(png).length} B`);
}

save('icon-192.png', 192, true, 1);
save('icon-512.png', 512, true, 1);
save('maskable-512.png', 512, false, 0.78);
save('apple-touch-icon.png', 180, false, 0.92);
