// THE WALL - 100 years in 15 seconds. Deterministic, seed 7311.
// Pure Node builtins: computes every frame as RGB, writes PPM, synthesizes WAV audio.
// ffmpeg (Gyan 9.0.2) assembles + encodes. No native deps.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

const W = 1280, H = 720, FPS = 30, DUR = 15, FRAMES = FPS * DUR;
const SEED = 7311;
const DIR = process.argv[2] || ".";

// ---------------- deterministic RNG + hash noise (wall-space) ----------------
function h1(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n ^= n >>> 16; return ((n >>> 0) % 100000) / 100000; }
function h2(a, b) { let x = ((a * 0x1b873594) ^ (b * 0xcc01aab9)) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; x ^= x >>> 15; return (x >>> 0) / 4294967295; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const pxv = v => clamp(Math.round(v), 0, 255);

// rnd() seeded global RNG (mulberry-ish). Defined BEFORE the plant/bands blocks
// that call rnd(); function declarations hoist, let bindings do not.
let _s = SEED >>> 0;
function rnd() { _s = (_s + 0x6D2B79F5) | 0; let x = Math.imul(_s ^ (_s >>> 15), 1 | _s); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }

// ---------------- wall geometry ----------------
// Bilinear value noise in wall-space. fbm: 3 octaves so weather features are soft
// blobs spanning several bricks (not per-pixel speckle and not per-brick chips).
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const d = x - xi, e = y - yi;
  const sx = d * d * (3 - 2 * d), sy = e * e * (3 - 2 * e);
  const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), dd = h2(xi + 1, yi + 1);
  return lerp(lerp(a, b, sx), lerp(c, dd, sx), sy);
}
function fbm(x, y) { return 0.6 * vnoise(x, y) + 0.35 * vnoise(x * 2 + 7, y * 2 + 7) + 0.15 * vnoise(x * 4 + 19, y * 4 + 19); }

const COLS = 53, ROWS = 60;   // brick modules ~2.2:1 (24px wide x 10.8 tall), not square
const WALL_X0 = W * 0.10, WALL_Y0 = H * 0.055;
const BW = W / COLS;
const BH = (H * 0.90) / ROWS;
const WALL_H = ROWS * BH;
// mortar joint width as a FRACTION of the module, per axis, so the joint reads the
// same ~2.4px on both directions for the 2.2:1 brick: ~10% of width, ~22% of height,
// tapering with erosion over the century.
const MORTAR_X = 0.10, MORTAR_Y = 0.22;

// ---------------- seeded per-brick properties (wall-space 0..1) ----------------
// Brick faces are red-brown. hue = kiln color temperature (coke-fired oranges vs
// smoky blue-bricks); sat/lum stay tight so the wall reads as one fired course, not confetti.
function bh(i, salt) { let x = ((i + 1) * 2654435761 ^ (salt + 1) * 0x85ebca6b ^ SEED * 0xc2b2ae35) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2545f491) >>> 0; return (x >>> 0) / 4294967295; }
const brick = new Array(ROWS * COLS);
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const i = r * COLS + c;
  brick[i] = {
    hue: bh(i, 1), sat: 0.35 + 0.30 * bh(i, 2), lum: 0.30 + 0.45 * bh(i, 3), grain: bh(i, 4),
    // Re-randomize the per-brick joint erosion rate (h2(c,r) is periodic at c=64,
    // which produced a visible vertical grid line every brick-width down the wall).
    jointLoss: 0.55 + 0.45 * bh(i, 5),   // how fast this joint erodes
    jwScale: 0.8 + 0.4 * bh(i, 9),       // per-brick pointing width — hand-troweled, not machine-cut
    sootCh: bh(i, 6),                    // rain channel / shield
    spallAt: 0.25 + 0.85 * bh(i, 7),     // year (frac of century) the face pops
    saltAt: 0.35 + 0.6 * bh(i, 8),       // efflorescence threshold
  };
}

// corner-initiated crack paths on the masonry (deterministic branching zigzag pattern).
const cracks = [];
for (let k = 0; k < 5; k++) {
  let cx = Math.floor(COLS * h1(k * 31 + 3)), cy = 0;
  const startYear = 0.28 + 0.45 * h1(k * 7 + 1);
  const dir = h1(k) < 0.5 ? 1 : -1;
  const pts = [[cx, cy]];
  const steps = 3 + Math.floor(4 * h1(k * 13 + 2));
  for (let s = 0; s < steps; s++) {
    cx += dir * (1 + Math.floor(3 * h1(k * 97 + s * 17)));
    cy += 2 + Math.floor(5 * h1(k * 53 + s * 29));   // ~2 module rows per step (courses are ~half the height now)
    if (h1(k * 71 + s) < 0.4) cx -= dir * 2;
    cx = clamp(cx, 0, COLS - 1); cy = clamp(cy, 0, ROWS - 1);
    pts.push([cx, cy]);
  }
  cracks.push({ pts, startYear, width: 0.5 + 1.6 * h1(k * 91 + 5) });
}

// climbing plant: deterministic growth recursion (stem gravitates upward)
const plant = (() => {
  const baseC = Math.floor(COLS * (0.28 + 0.4 * rnd()));
  const segs = [];
  let x = baseC, y = ROWS + 0.5, ang = -Math.PI / 2 + (rnd() - 0.5) * 0.35;
  for (let i = 0; i < 80; i++) {
    const step = 0.68 + 0.6 * rnd();   // module-space steps doubled: courses are half as tall now
    ang += (rnd() - 0.5) * 0.55; ang = lerp(ang, -Math.PI / 2, 0.30);
    const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step * 1.15;
    segs.push({ x0: x, y0: y, x1: nx, y1: ny, leaf: rnd() < 0.42 ? rnd() : -1, t0: i / 80 });
    x = nx; y = ny; if (y < -1) break;
  }
  return { baseC, segs };
})();
// companion climbers: a specimen of one vine was the weakest note in v2 — a
// real overgrown wall has several, established in different decades.
const plant2 = (() => {
  const baseC = Math.floor(COLS * (0.57 + 0.08 * rnd()));
  const segs = [];
  let x = baseC, y = ROWS + 0.5, ang = -Math.PI / 2 + (rnd() - 0.5) * 0.35;
  for (let i = 0; i < 46; i++) {
    const step = 0.68 + 0.6 * rnd();
    ang += (rnd() - 0.5) * 0.55; ang = lerp(ang, -Math.PI / 2, 0.30);
    const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step * 1.15;
    segs.push({ x0: x, y0: y, x1: nx, y1: ny, leaf: rnd() < 0.42 ? rnd() : -1, t0: i / 46 });
    x = nx; y = ny; if (ny < 32) break;
  }
  return { baseC, segs, startGrow: 0.50 };
})();
const plant3 = (() => {
  const baseC = Math.floor(COLS * (0.20 + 0.07 * rnd()));
  const segs = [];
  let x = baseC, y = ROWS + 0.5, ang = -Math.PI / 2 + (rnd() - 0.5) * 0.35;
  for (let i = 0; i < 30; i++) {
    const step = 0.68 + 0.6 * rnd();
    ang += (rnd() - 0.5) * 0.55; ang = lerp(ang, -Math.PI / 2, 0.30);
    const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step * 1.15;
    segs.push({ x0: x, y0: y, x1: nx, y1: ny, leaf: rnd() < 0.42 ? rnd() : -1, t0: i / 30 });
    x = nx; y = ny; if (ny < 46) break;
  }
  return { baseC, segs, startGrow: 0.60 };
})();

// ---------------- graffiti: two seeded spray tags ----------------
// A legible tag (the word MEMORY, in the HUD's 5x7 stencil face) sprayed to the
// lower left, plus an anonymous ring-and-cross thrown on the right side. Painted
// mid-century; the paint itself weathers - greys, chips in speckle, rain-washed.
const TAG_WORD = "MEMORY";
const tags = [
  // chalky cream letters against dark Depression-era brick: a can of light
  // paint thrown over a grimy wall. Readable for a generation, gone by the 2010s.
  { kind: "word", sprayAt: 0.55, fadeAt: 0.80, fadeEnd: 0.905, seed: 31, cr: 214, cg: 206, cb: 170 },
  { kind: "ring", cx: 33.4, cy: 22.0, rr: 58, sprayAt: 0.60, fadeAt: 0.83, fadeEnd: 0.93, seed: 57, cr: 62, cg: 84, cb: 200 },
];

// ---------------- palette + seeded weather bands ----------------
const warm = [1.06, 0.94, 0.80], cold = [0.82, 0.90, 1.10];
function palette(age) { const k = smoothstep(0.05, 0.95, age); return [lerp(warm[0], cold[0], k), lerp(warm[1], cold[1], k), lerp(warm[2], cold[2], k)]; }
const bands = [];
// kind: 0 overcast/rain (desaturating), 1 sun (saturated warm), 2 fog/flat light.
// Fog is the only one that cuts saturation hard; rain stays mild, so the wall's
// red-brown identity never greys out mid-film.
{ let t = 0.06; while (t < 0.98) { const len = 0.05 + 0.13 * rnd(); bands.push({ t0: t, t1: t + len, kind: Math.floor(rnd() * 3), amt: 0.4 + 0.6 * rnd() }); t += len + 0.06 + 0.16 * rnd(); } }
function weather(age) {
  let ex = 1, sat = 1, t0 = 1, t1 = 1, t2 = 1;
  for (const b of bands) {
    const k = smoothstep(b.t0 - 0.03, b.t0 + 0.03, age) * (1 - smoothstep(b.t1 - 0.03, b.t1 + 0.03, age));
    if (b.kind === 0) { sat *= lerp(1, 0.72, k * b.amt); ex *= lerp(1, 0.94, k * b.amt); }
    else if (b.kind === 1) { sat *= lerp(1, 1.18, k * b.amt); ex *= lerp(1, 1.07, k * b.amt); }
    else { sat *= lerp(1, 0.62, k * b.amt); ex *= lerp(1, 0.90, k * b.amt); t0 *= lerp(1, 0.96, k); t1 *= lerp(1, 1.0, k); t2 *= lerp(1, 1.05, k); }
  }
  return { ex: clamp(ex, 0.8, 1.12), sat: clamp(sat, 0.6, 1.25), tint: [t0, t1, t2] };
}

// ---------------- drawing helpers (direct RGB on Uint8 buffer) ----------------
let buf = new Uint8Array(W * H * 3);
function blendPix(buf, xx, yy, cr, cg, cb, k) { const j = (yy * W + xx) * 3; buf[j] += (cr - buf[j]) * k; buf[j + 1] += (cg - buf[j + 1]) * k; buf[j + 2] += (cb - buf[j + 2]) * k; }
function strokeTo(buf, segs, thick, cr, cg, cb, alpha) {
  for (const s of segs) {
    const x0 = s[0], y0 = s[1], x1 = s[2], y1 = s[3];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= steps; i++) {
      const X = lerp(x0, x1, i / steps), Y = lerp(y0, y1, i / steps);
      for (let dy = -thick; dy <= thick; dy++) for (let dx = -thick; dx <= thick; dx++) {
        if (dx * dx + dy * dy > thick * thick) continue;
        const xx = Math.round(X + dx), yy = Math.round(Y + dy);
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        blendPix(buf, xx, yy, cr, cg, cb, alpha);
      }
    }
  }
}
function drawText(buf, str, x, y, size, tracking, cr, cg, cb, alpha) {
  // Direct pixel compositing: each filled cell of the 5x7 glyph becomes a solid
  // rect. strokeTo-based cell-dot rendering was far too sparse to read as text.
  const cs = size / 5;                       // cell size in px
  let x0 = Math.round(x);
  for (const ch of str) {
    const rows = G5[ch] ?? G5[" "];
    const gw = rows && rows.length ? 5 : 4;  // blank advance
    for (let r = 0; r < 5; r++) {
      if (!rows || !rows[r]) continue;
      for (let cc = 0; cc < 5; cc++) {
        if (rows[r][cc] !== "1") continue;
        // G5 rows are stored top-down; y is the text baseline (bottom).
        const px0 = x0 + Math.round(cc * cs), py0 = Math.round(y - (5 - r) * cs);
        for (let yy = py0; yy < py0 + Math.ceil(cs); yy++) {
          if (yy < 0 || yy >= H) continue;
          for (let xx = px0; xx < px0 + Math.ceil(cs); xx++) {
            if (xx < 0 || xx >= W) continue;
            const i = (yy * W + xx) * 3;
            buf[i] = buf[i] * (1 - alpha) + cr * alpha;
            buf[i + 1] = buf[i + 1] * (1 - alpha) + cg * alpha;
            buf[i + 2] = buf[i + 2] * (1 - alpha) + cb * alpha;
          }
        }
      }
    }
    x0 += Math.round((1.6 + tracking) * size);
  }
}

// ---------------- 5x7 vector font ----------------
const FONT = {
  'A': ['###..', '#...#', '#...#', '#####', '#...#'], // placeholder replaced below
};
// Each glyph: [rows of 5 cols, top-down]. Segments derived from filled cells.
const GLYPHS = {
  '0': ["###", "#.#", "#.#", "#.#", "###"],
  '1': ["#..", "##.", "#..", "#..", "###"],
  '2': ["###", "..#", ".##", "#..", "###"],
  '3': ["###", "..#", ".##", "..#", "###"],
  '4': ["#.#", "###", "..#", "..#", "..#"], // not used but kept for completeness
  '5': ["###", "#..", "###", "..#", "###"],
  '6': ["###", "#..", "###", "#.#", "###"],
  '7': ["###", "..#", "..#", "..#", "..#"],
  '8': ["###", "#.#", "###", "#.#", "###"],
  '9': ["###", "#.#", "###", "..#", "###"],
  '4x': [],
  ' ': [],
  '-': ["...","...","###","...","..."],
  '.': ["...","...","...","...","#.."],
};
// proper 5-wide glyphs for the digits we actually draw + letters for title card
const G5 = {
  '0': ["01110","10001","10001","10001","01110"],
  '1': ["00100","01100","00100","00100","01110"],
  '2': ["01110","00001","00010","00100","01111"], // approx of classic
  '3': ["11110","00001","01110","00001","11110"],
  '4': ["10010","10010","11111","00010","00010"],
  '5': ["11111","10000","11110","00001","11110"],
  '6': ["01110","10000","11110","10001","01110"],
  '7': ["11111","00001","00010","00100","00100"],
  '8': ["01110","10001","01110","10001","01110"],
  '9': ["01110","10001","01111","00001","01110"],
  'M': ["10001","11011","10101","10001","10001"],
  'O': ["01110","10001","10001","10001","01110"],
  'R': ["11110","10001","11110","10100","10001"],
  'Y': ["10001","10001","01010","00100","00100"],
  '-': ["00000","00000","01110","00000","00000"],
  '.': ["00000","00000","00000","00000","00100"],
  ':': ["00000","00100","00000","00100","00000"],
  'T': ["11111","00100","00100","00100","00100"],
  'H': ["10001","10001","11111","10001","10001"],
  'E': ["11111","10000","11110","10000","11111"],
  'W': ["10001","10001","10101","10101","01010"],
  'A': ["01110","10001","11111","10001","10001"],
  'L': ["10000","10000","10000","10000","11111"],
  ' ': [],
};
function glyphSegs(ch) {
  const rows = G5[ch] ?? G5[' '];
  const segs = [];
  if (!rows || rows.length === 0) return { w: 2.6, segs };
  // horizontal runs + vertical runs per cell
  for (let r = 0; r < 5; r++) for (let cc = 0; cc < 5; cc++) {
    if (rows[r][cc] !== '1') continue;
    const x = cc * 0.2, y = 4 - r; // font-space: y up
    segs.push([x, y, x + 0.2, y]);           // cell block as a short stroke
  }
  return { w: 5 * 0.2 + 0.6, segs };
}

// v3: structural collapse — masonry doesn't just discolor, it comes apart.
// Seeded failure zones: coping courses, parapet corners, mid-wall holes, the base,
// and finally a last standing column that holds through everything and topples in
// the closing seconds — the wall gives up at the very end.
function voidOf(c, rr) {
  const j = h2(c * 7 + 3, rr * 13 + 1);
  const jm = h2(c * 17 + 5, rr * 23 + 11);          // per-module timing scatter
  const islet = h2(c * 11 + rr * 3, 71) < 0.22;     // masonry that holds longer than its zone
  let v = null;
  if (rr <= 6) v = 0.80 + rr * 0.012 + 0.06 * j;
  else if (c >= 8 && c <= 14 && rr <= 13) v = 0.66 + rr * 0.01 + 0.08 * j;
  else if (c >= 20 && c <= 29 && rr >= 12 && rr <= 24) v = 0.62 + (rr - 12) * 0.012 + (c - 20) * 0.008 + 0.05 * j;
  else if (c >= 39 && c <= 48 && rr >= 30 && rr <= 44) v = 0.74 + (c - 39) * 0.01 + (rr - 30) * 0.008 + 0.05 * j;
  else if (c >= 10 && c <= 40 && rr >= 53) v = 0.88 + (59 - rr) * 0.012 + 0.06 * j;
  else if (c >= 30 && c <= 36 && rr <= 46) v = 0.955 + rr * 0.0008 + 0.02 * j;
  else if (c >= 30 && c <= 36) v = 0.985 + 0.01 * j;
  if (v === null) return null;
  // the last column: tiny scatter only — it must stand past the film's mid-point
  if (c >= 30 && c <= 36) return clamp(v + 0.05 * (jm - 0.5), 0.95, 0.999);
  // modules don't leave on a schedule: scatter their exits by ±0.09, and 22% of
  // them hold a fifth-of-a-century longer — holes stay irregular, with islands
  v += 0.18 * (jm - 0.5) + (islet ? 0.20 + 0.15 * jm : 0);
  return clamp(v, 0.02, 0.997);
}
// where the fallen masonry piles up at the footing, under each failure zone
const DEBRIS = [
  { c0: 20, c1: 29, at: 0.66, rb: 18 },
  { c0: 39, c1: 48, at: 0.78, rb: 36 },
  { c0: 8, c1: 14, at: 0.70, rb: 8 },
  { c0: 10, c1: 40, at: 0.90, rb: 56 },
  { c0: 30, c1: 36, at: 0.958, rb: 40 },
];

// ---------------- per-pixel wall rendering ----------------
function renderWall(age, fr) {
  const pal = palette(age), we = weather(age);
  for (let y = 0; y < H; y++) {
    const rowF = (y - WALL_Y0) / BH;
    const inWallY = rowF >= 0 && rowF < ROWS;
    for (let x = 0; x < W; x++) {
      let r, g, b;
      if (y >= H * 0.94) {
        // foreground ground: asphalt-ish with age tint + seeded rubble speckle
        const gg = h2(x >> 1, y);
        let base = lerp(78, 56, age) - 18 * smoothstep(H * 0.94, H, y);
        r = base * (0.8 + 0.35 * gg); g = base * (0.82 + 0.3 * gg); b = base * (0.86 + 0.25 * gg);
        // fallen masonry: brick chips mounded at the footing under each failure
        // zone, appearing as the bricks themselves go out of the wall
        for (const Z of DEBRIS) {
          const zx0 = WALL_X0 + Z.c0 * BW - 30, zx1 = WALL_X0 + (Z.c1 + 1) * BW + 30;
          if (x < zx0 || x > zx1) continue;
          if (age < Z.at - 0.02) continue;
          const dens = (age - (Z.at - 0.02)) / (1.05 - Z.at);
          const u = (x - zx0) / (zx1 - zx0);
          const mound = Math.max(0, 1 - Math.abs(u - 0.5) * 1.5);
          const band = H * 0.94 + 2 + 15 * mound * dens;
          if (y >= band || h2(x >> 1, y + 91) > dens * mound * 0.8) continue;
          const bc = brick[clamp(Z.rb, 0, ROWS - 1) * COLS + clamp(Math.floor((x - WALL_X0) / BW), 0, COLS - 1)];
          const v = (0.7 + 0.6 * bc.lum) * (0.8 + 0.4 * h2(x, y));
          r = 150 * v * 0.62; g = 108 * v * 0.62; b = 84 * v * 0.62;
        }
      } else if (!inWallY) {
        // sky above / background strip below the wall top: soft horizon gradient
        if (y < WALL_Y0) {
          const k = y / WALL_Y0;
          r = lerp(120, 176 - 40 * age, k); g = lerp(118, 178 - 30 * age, k); b = lerp(126, 184 + 12 * age, k);
        } else {
          // ground behind wall: receding cinder/soil band with seeded speckle
          const gy = smoothstep(0, H - (WALL_Y0 + WALL_H), y - (WALL_Y0 + WALL_H));
          const gb = lerp(152, 96, age * 0.8) * (1.04 - 0.12 * gy);
          r = gb; g = gb * lerp(0.95, 0.87, age); b = gb * lerp(0.80, 0.96, age);
          const gh = h2(x, 3 + Math.floor(gy * 40));
          if (gh < 0.06 + 0.26 * age) { r *= 0.74; g *= 0.78; b *= 0.60; }
        }
      } else {
        const colF = (x - WALL_X0) / BW;
        if (colF < 0 || colF >= COLS) { r = 52; g = 50; b = 56; }
        else {
          const rr = Math.floor(rowF);
          // running bond: alternate courses offset half a brick. Straight joints
          // (stack bond) read as a screen-door mesh and were half the grid problem.
          const sb = (rr & 1) ? 0.5 : 0;
          const colB = colF - sb;
          const c = Math.floor(colB), B = brick[rr * COLS + clamp(c, 0, COLS - 1)];
          const lx = colB - c, ly = rowF - rr;
          // Weather clouds: broad soot/bleaching field over the whole wall face,
          // continuous across bricks and joints. Continuous fbm in screen-pixel
          // coords (~150px blobs), sampled at every pixel — this is what stops the
          // wall reading as a checkerboard of per-brick color chips.
          const sx = WALL_X0 + colF * BW, sy = WALL_Y0 + rowF * BH;
          const wc = fbm(sx / 260 + 40, sy / 260 + 12) * 0.85 + fbm(sx / 90 + 40, sy / 90 + 12) * 0.15;
          // broad grime/bleach field: continuous across bricks AND joints, and kept
          // below full strength so it never flashes white/black at the extremes.
          // (wDark capped hard: soot/grime/wDark stack multiplicatively, and the old
          // 0.48 ceiling took the wall down toward 0.37 of base lum — muddy and dark.)
          const wDark = smoothstep(0.35, 0.65, 1 - wc) * (0.14 + 0.20 * smoothstep(0.1, 0.7, age));
          // Bleach patches: narrower range so the wall never blows out to near-white;
          // strength capped at ~22% and target color pulled closer to mid brick tone.
          const wPale = smoothstep(0.58, 0.92, wc) * (0.10 + 0.12 * smoothstep(0.1, 0.7, age));
          // grime depth also varies continuously over the wall (soot + rain streaks):
          // this is the pass that ties bricks and joints together into one dirty surface.
          // Mid-cut: grime builds through mid-century then relaxes slightly — a wall
          // that sits upwind of soot gets rain-washed again, it doesn't just char.
          const sootField = fbm(sx / 150 + 5, sy / 200 + 31) * 0.8 + fbm(sx / 60 + 5, sy / 90 + 31) * 0.2;
          const grimeK = smoothstep(0.30, 0.75, sootField) * (0.16 + 0.22 * smoothstep(0.1, 0.55, age)) * (1 - 0.35 * smoothstep(0.8, 1, age));
          // rain-streak field: continuous fbm stretched vertically (~75px wide x ~24px
          // tall = long runs). Also global: applied to joints and faces alike.
          const streakField = fbm(sx / 75 + 55, sy / 24 + 3);
          const jk = (1 - 0.75 * smoothstep(0.15, 0.85, age) * B.jointLoss) * B.jwScale;
          const jwX = MORTAR_X * jk, jwY = MORTAR_Y * jk;
          // structural voids: a brick (module) leaves the wall at its own time,
          // the boundary dithered per-pixel so holes tear open, not cut clean
          const va = voidOf(clamp(c, 0, COLS - 1), rr);
          const inVoid = va !== null && age > va + (h2(x >> 2, (y >> 2) + rr * 3) - 0.5) * 0.05 + (h2(x, y) - 0.5) * 0.008;
          const inJX = lx < jwX || lx > 1 - jwX, inJY = ly < jwY || ly > 1 - jwY;
          if (inVoid) {
            // the cavity: a darker second brick-course set back behind the face,
            // warm shadowed masonry (not a black hole punched in scenery)
            const dn = 0.62 - 0.30 * fbm(sx / 34 + 5, sy / 34 + 9);
            r = 168 * dn * (0.92 + 0.16 * h2(x, y)); g = 74 * dn * 1.06; b = 52 * dn * 1.1;
            const gx = ((sx - WALL_X0) % BW), gy = ((sy - WALL_Y0 + rr * BH) % BH);
            if (gx < 1.6 || gy < 2.6) { r *= 0.55; g *= 0.55; b *= 0.55; }
            // freshly broken stays warm-toned for a moment after the loss — the
            // flash rides the failure front as it progresses down the zone
            const fresh = (1 - smoothstep(va, va + 0.05, age)) * (0.3 + 0.7 * h2(x * 3, y * 3));
            r += 84 * fresh; g += 62 * fresh; b += 44 * fresh;
          } else if (inJX || inJY) {
            // mortar: pale lime, cures early then erodes back to the module edge.
            // It is recessed and collects grime, so it reads DARKER than the face as
            // the century goes on (chalky-white early, sooty grey-brown late). Joints
            // are kept narrow and low-contrast so they don't draw attention to the grid.
            const cure = smoothstep(0.0, 0.06, age);
            let m = lerp(214, 142, smoothstep(0.15, 0.75, age));
            m *= lerp(0.72, 1, cure);
            const shX = (lx < jwX ? lx : 1 - lx) / Math.max(jwX, 1e-6);
            const shY = (ly < jwY ? ly : 1 - ly) / Math.max(jwY, 1e-6);
            const shade = 0.80 + 0.20 * smoothstep(0, 0.5, Math.min(shX, shY));
            r = m * shade; g = m * shade * 0.97; b = m * shade * 0.88;
            const edge = Math.min(lx < jwX ? lx : lx - (1 - jwX), ly < jwY ? ly : ly - (1 - jwY));
            if (edge < 0) { const e = clamp(-edge / 0.10, 0, 1) * 0.35; r -= 48 * e; g -= 44 * e; b -= 38 * e; }
            if (age > B.saltAt && B.jointLoss > 0.8) { const s = smoothstep(B.saltAt, B.saltAt + 0.2, age) * 0.35; r = lerp(r, 214, s); g = lerp(g, 212, s); b = lerp(b, 206, s); }
            if (wDark > 0) { const k = wDark; r *= 1 - k * 0.55; g *= 1 - k * 0.42; b *= 1 - k * 0.30; }
            // Bleach patches: narrow range so the wall never blows out to near-white;
            // strength capped at ~30% and target color pulled closer to mid brick tone.
            if (wPale > 0) { const k = wPale * 0.5; r = lerp(r, 165, k); g = lerp(g, 128, k); b = lerp(b, 92, k); }
            if (grimeK > 0) { const k = grimeK * 0.6 * (0.75 + 0.5 * smoothstep(0.30, 0.80, streakField)); r *= 1 - k * 0.55; g *= 1 - k * 0.50; b *= 1 - k * 0.38; }
          } else {
            // brick face: seeded color + century darkening (wall-space constants).
            // BRICK_* is the mid-tone fired color; B.hue drives it along a warm
            // red-brown axis only (no full-spectrum lerp into olive/scarlet).
            // Variance kept modest (0.75..1.12) so the broad weather clouds, not the
            // per-brick chips, set the wall's appearance.
            const BRICK_R = 168, BRICK_G = 74, BRICK_B = 52;
            const wearK = smoothstep(0.35, 0.9, age);
            let br = lerp(BRICK_R * 0.75, BRICK_R * 1.12, B.lum) * lerp(1, 0.90, age * 0.5);
            let bg = BRICK_G * (0.88 + 0.24 * B.sat) * (0.94 + 0.14 * B.hue) * lerp(1, 0.85, age * 0.55);
            let bb = BRICK_B * (0.86 + 0.28 * (1 - B.hue)) * (0.92 + 0.16 * B.sat) * lerp(1, 0.79, age * 0.6);
            // per-brick chip goes soft as the century wears the surface down: old walls
            // lose their kiln-variance (bleaching + soot homogenize the face).
            br = lerp(br, BRICK_R * lerp(1, 0.90, age * 0.5), wearK * 0.75);
            bg = lerp(bg, BRICK_G * lerp(1, 0.85, age * 0.55), wearK * 0.75);
            bb = lerp(bb, BRICK_B * lerp(1, 0.79, age * 0.6), wearK * 0.75);
            // grain: fired-brick surface mottling, kept subtle; weathering layers on top.
            const spk = 0.96 + 0.08 * B.grain;
            br *= spk; bg *= spk; bb *= spk;
            if (wDark > 0) { const k = wDark; br *= 1 - k * 0.55; bg *= 1 - k * 0.42; bb *= 1 - k * 0.30; }
            // Bleach patches: narrow range so the wall never blows out to near-white;
            // strength capped at ~30% and target color pulled closer to mid brick tone.
            if (wPale > 0) { const k = wPale; br = lerp(br, 165, k); bg = lerp(bg, 128, k); bb = lerp(bb, 92, k); }
            // formwork lines, rubbing off through the century
            const fw = (1 - smoothstep(0.02, 0.20, age)) * ((Math.floor(lx * 9) === 0 || Math.floor(ly * 9) === 0) ? 0.10 : 0);
            br -= 34 * fw; bg -= 30 * fw; bb -= 26 * fw;
            // spalling: face pops late, pale inner body exposed (un-fired clay, warm tint).
            // The field is a continuous fbm; the gate rises slowly with age and is nudged
            // per-brick only slightly so faces pop one by one over decades while the noise
            // keeps patch edges organic. At this viewing distance a full-strength per-brick
            // pop is indistinguishable from a checkerboard, so the effect is kept modest:
            // ~1 in 4 faces at end of century, half strength, small pale halo on each.
            const spField = fbm(sx / 90 + 61, sy / 90 + 23) * 0.7 + fbm(sx / 30 + 13, sy / 30 + 47) * 0.3;
            const spGate = (0.35 + 0.68 * smoothstep(0.55, 1.0, age)) * (0.92 + 0.16 * B.spallAt);
            const spAll = smoothstep(spGate - 0.07, spGate + 0.07, spField) * 0.45;
            if (spAll > 0) {
              br = lerp(br, BRICK_R * 1.42, spAll); bg = lerp(bg, BRICK_G * 1.35, spAll); bb = lerp(bb, BRICK_B * 1.3, spAll);
            }
            // soot: capillary rise + grime clouds. fromGround normalized to the wall
            // face (0 at base, 1 at top). The field is continuous fbm in screen-pixel
            // coords, stretched vertically (~75px wide x ~24px tall = long rain streaks).
            const fromGround = clamp((rr + (1 - ly)) / (ROWS - 1), 0, 1);
            // soot front: climbs the lower half through the first ~40 years, then stalls;
            // low max intensity (grime films over, never chars) — and the cap relaxes a
            // little in the last quarter as prevailing wind rain-washes the surface.
            const riseFront = 0.05 + 0.75 * smoothstep(0.0, 0.45, age);
            let soot = smoothstep(riseFront + 0.12, riseFront - 0.12, fromGround) * (0.12 + 0.23 * smoothstep(0.05, 0.6, age)) * (1 - 0.3 * smoothstep(0.72, 1, age));
            soot *= 0.75 + 0.5 * smoothstep(0.30, 0.80, streakField);
            // subtractive grime keeps the brick hue; soot multipliers never go negative
            r = br * (1 - 0.62 * soot); g = bg * (1 - 0.58 * soot); b = bb * (1 - 0.48 * soot);
            if (grimeK > 0) { const k = grimeK; r *= 1 - k * 0.55; g *= 1 - k * 0.50; b *= 1 - k * 0.38; }
          }
          // moss: slow damp-driven reaction front descending from the parapet.
          // Coverage falls off smoothly with height above the front; fbm threshold
          // softens over ±0.15 so growth edges are wispy, brick-scale.
          // Noise in screen-pixel coords (~90px blobs + ~36px detail + ~22px fine).
          const damp = 0.35 + 0.65 * Math.abs(Math.sin(age * 3.1));
          const mossFront = clamp((age - 0.42) * 1.1, 0, 0.75);
          if (mossFront > 0 && rr / ROWS < mossFront + 0.10) {
            const mx = WALL_X0 + colF * BW, my = WALL_Y0 + rowF * BH;
            const nMoss = fbm(mx / 90, my / 90) * 0.5 + fbm(mx / 36 + 31, my / 36 + 17) * 0.3 + fbm(mx / 18 + 71, my / 18 + 43) * 0.2;
            const heightK = smoothstep(mossFront + 0.10, mossFront - 0.15, rr / ROWS);
            const mAll = smoothstep(0.47, 0.85, nMoss) * damp * (0.28 + 0.34 * B.grain) * heightK;
            r = lerp(r, 78 + 30 * B.grain, mAll); g = lerp(g, 96 + 40 * B.grain, mAll); b = lerp(b, 52, mAll);
          }
          // cracks: corner-initiated, grow along seeded paths. Width in wall-module
          // units; the dark line is a hairline fissure, not a brush stroke.
          for (const K of cracks) {
            const prog = clamp((age - K.startYear) / (1 - K.startYear), 0, 1);
            if (prog <= 0) continue;
            const n = Math.floor(prog * (K.pts.length - 1));
            for (let i = 0; i <= n; i++) {
              const a = K.pts[i], b2 = K.pts[Math.min(i + 1, K.pts.length - 1)];
              if (Math.abs(colF - lerp(a[0] + 0.5, b2[0] + 0.5, 0.5)) < 0.5 && Math.abs(rowF - lerp(a[1] + 0.5, b2[1] + 0.5, 0.5)) < 0.5) {
                const d = Math.hypot(colF - (a[0] + 0.5), rowF - (a[1] + 0.5));
                if (d < K.width * 0.06) { r *= 0.42; g *= 0.44; b *= 0.46; }
              }
            }
          }
          // mortar erosion bite: notches out of joints driven by a seeded field
          const notch = fbm(colF * 3 + rr, rowF * 3) * (1 - smoothstep(0.25, 0.9, age));
          if ((inJX || inJY) && notch > 0.78) { r *= 0.6; g *= 0.62; b *= 0.64; }

          // Brick edges: a hairline shadow along the module edge (undercut where the
          // joint erodes back). Continuous across every face, so it also breaks up
          // any residual grid-line from per-brick seed boundaries.
          {
            const dX = lx < jwX ? lx : lx - (1 - jwX);
            const dY = ly < jwY ? ly : ly - (1 - jwY);
            const dEdge = Math.min(dX, dY);
            if (dEdge < 0) {
              const e = clamp(-dEdge / 0.06, 0, 1) * 0.30;   // ~1.4px of module shoulder
              r *= 1 - e * 0.55; g *= 1 - e * 0.50; b *= 1 - e * 0.45;
            }
          }
        }
      }
      // palette grade + weather exposure/saturation/tint (flat neutral for HUD-safe areas later)
      const [pr, pg, pb] = pal;
      let R = r * pr, G = g * pg, Bv = b * pb;
      const lum = 0.299 * R + 0.587 * G + 0.114 * Bv;
      R = lerp(lum, R, we.sat) * we.ex * we.tint[0];
      G = lerp(lum, G, we.sat) * we.ex * we.tint[1];
      Bv = lerp(lum, Bv, we.sat) * we.ex * we.tint[2];
      const j = (y * W + x) * 3;
      buf[j] = pxv(R); buf[j + 1] = pxv(G); buf[j + 2] = pxv(Bv);
    }
  }
}

function renderPlant(P, age) {
  const g0 = P.startGrow ?? 0.45;
  const grow = smoothstep(g0, Math.min(1.0, g0 + 0.53), age);
  if (grow <= 0) return;
  // Ivy as a MASS of foliage, not a fishbone: an fbm-masked band hugging the stem
  // path, its half-width thickening from a bare twig to a ~26px leafy column as
  // local growth swells. The woody stem stays a hairline so the trunk reads through.
  for (const S of P.segs) {
    if (S.t0 > grow) break;
    const x0 = WALL_X0 + S.x0 * BW, y0 = WALL_Y0 + S.y0 * BH, x1 = WALL_X0 + S.x1 * BW, y1 = WALL_Y0 + S.y1 * BH;
    const localK = clamp((grow - S.t0) / 0.10, 0, 1);   // leaf mass swells in after the stem
    const len = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const nx = (y1 - y0) / len, ny = -(x1 - x0) / len;  // unit normal to the stem
    const stemK = 1 - 0.55 * S.t0;                     // woody base, thinning toward the tip
    for (let i = 0; i <= len; i++) {
      const t = i / len;
      const px = lerp(x0, x1, t), py = lerp(y0, y1, t);
      const sx = Math.round(px), sy = Math.round(py);
      if (sx >= 0 && sx < W && sy >= 0 && sy < H) blendPix(buf, sx, sy, 78, 58, 34, 0.55 * stemK);
      if (localK <= 0) continue;
      const hw = lerp(3, 32, localK) * (0.55 + 0.7 * fbm(px / 60 + 3, py / 60 + 9));
      for (let o = -hw; o <= hw; o += 0.8) {
        const xx = Math.round(px + nx * o), yy = Math.round(py + ny * o);
        if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) continue;
        const edge = 1 - Math.abs(o) / Math.max(hw, 1e-6);
        const leafN = fbm(xx / 7 + 11, yy / 7 + 5) * 0.6 + fbm(xx / 16 + 27, yy / 16 + 13) * 0.4;
        const k = smoothstep(0.28, 0.55, leafN) * (0.35 + 0.55 * edge) * localK;
        if (k <= 0.02) continue;
        // leaf color: live green + sun-dying tan patches; tips of the vine are half
        // dead — an overgrown climber at century scale is patchy, not aquarium green.
        const gv = 0.75 + 0.5 * fbm(xx / 9 + 41, yy / 9 + 19);
        const dead = smoothstep(0.42, 0.72, fbm(xx / 14 + 51, yy / 14 + 3)) * (0.3 + 0.7 * S.t0);
        const lr = lerp(46 * gv, 92 * gv, dead), lg = lerp(92 * gv, 86 * gv, dead), lb = lerp(38 * gv, 58 * gv, dead);
        blendPix(buf, xx, yy, lr, lg, lb, k * 0.62);
      }
    }
  }
}

function renderGraffiti(age) {
  // The tag appears the instant it's sprayed (spray paint is instant), persists
  // while the wall keeps weathering around it, then UV + rain take it: the color
  // greys toward mortar grey and the paint chips off in speckle (noise thresholds
  // rise with fk) so it dissolves rather than scaling out.
  for (const T of tags) {
    const env = smoothstep(T.sprayAt, T.sprayAt + 0.01, age) * (1 - smoothstep(T.fadeAt, T.fadeEnd, age));
    if (env <= 0) continue;
    const fk = Math.max(0.6 * smoothstep(T.sprayAt + 0.03, T.fadeAt, age), 1 - env);
    const paintPx = (xx, yy, baseA, col) => {
      if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= Math.floor(H * 0.94)) return;
      const sd = T.seed * 101;
      // speckle erosion: stays weak through the decades so the letters stay
      // legible, only chipping hard in the final wash-out
      if (h2(xx * 2.7 + sd, yy * 1.7 + 7) < 0.04 + 0.42 * fk) return;
      const C = col || T;
      const cr = lerp(C.cr, 118, 0.5 * fk), cg = lerp(C.cg, 116, 0.5 * fk), cb = lerp(C.cb, 112, 0.5 * fk);
      const a = baseA * env * (0.78 + 0.22 * fbm(xx / 3.5 + 9, yy / 3.5 + 4)) * (1 - 0.32 * fk);
      if (a <= 0.03) return;
      blendPix(buf, xx, yy, cr, cg, cb, Math.min(a, 0.88));
    };
    if (T.kind === "word") {
      // MEMORY, tagged in the HUD's stencil face; chalk cream caps on dark brick.
      // Eye level: a hand tagged by a ladder, not a mural.
      const size = 30, cs = size / 5, track = 0.5;
      let x0 = Math.round(WALL_X0 + 9 * BW);
      const y0 = Math.round(WALL_Y0 + 30 * BH);
      for (const ch of TAG_WORD) {
        const rows = G5[ch] ?? G5[" "];
        for (let rr2 = 0; rr2 < 5; rr2++) for (let cc = 0; cc < 5; cc++) {
          if (!rows || !rows[rr2] || rows[rr2][cc] !== "1") continue;
          const px0 = x0 + Math.round(cc * cs), py0 = Math.round(y0 - (5 - rr2) * cs);
          for (let yy = py0; yy < py0 + Math.ceil(cs); yy++)
            for (let xx = px0; xx < px0 + Math.ceil(cs); xx++) paintPx(xx, yy, 0.78);
        }
        x0 += Math.round((1.6 + track) * size);
      }
      const wEnd = x0;
      const RED = { cr: 200, cg: 58, cb: 50 };
      // red underline + runs-out: the spray can pulled a fast stroke
      for (let xx = Math.round(WALL_X0 + 9 * BW) - 6; xx <= wEnd + 4; xx++) {
        paintPx(xx, y0 + 6, 0.66, RED);
        if ((xx - wEnd) % 7 === 0 && h2(xx, 13) < 0.3) paintPx(xx, y0 + 7, 0.55, RED);
      }
      for (const [dxx, dyy, dl] of [[18, 20, 16], [205, 16, 22], [340, 22, 14]]) {
        const dx = Math.round(WALL_X0 + 9 * BW) + dxx;
        for (let k = 0; k < dl; k++) paintPx(dx, y0 - dyy + k, 0.62);
      }
      // overspray halo: faint dots around the letter cells
      for (let i2 = 0; i2 < 140; i2++) {
        const ox = x0 - 150 + h2(i2, T.seed + 3) * 230, oy = y0 - 40 + h2(i2 + 40, T.seed + 9) * 56;
        paintPx(Math.round(ox), Math.round(oy), 0.12 * (0.4 + 0.6 * h2(i2, 21)));
      }
    } else {
      // ring-and-cross throw-up: a fat-outline loop + crossed bar + tail,
      // weathering identically. One smooth loop, not a sketchy ball of string.
      const cxp = WALL_X0 + T.cx * BW, cyp = WALL_Y0 + T.cy * BH;
      for (let a2 = 0; a2 < 120; a2++) {
        const th = (a2 / 120) * Math.PI * 2;
        const rad = T.rr + 5 * Math.sin(th * 3 + T.seed) + (h2(a2, T.seed + 5) - 0.5) * 4;
        for (let rdt = -3; rdt <= 3; rdt++) {
          const xx = Math.round(cxp + Math.cos(th) * (rad + rdt * 1.6)), yy = Math.round(cyp + Math.sin(th) * (rad + rdt * 1.6));
          paintPx(xx, yy, 0.9 * (1 - Math.abs(rdt) / 4));
        }
      }
      for (let d = -T.rr * 1.25; d <= T.rr * 1.25; d += 0.7) {
        const t2 = d / (T.rr * 1.25);
        paintPx(Math.round(cxp + t2 * T.rr * 1.15), Math.round(cyp - t2 * T.rr * 1.15), 0.82);
        paintPx(Math.round(cxp - t2 * T.rr * 1.15), Math.round(cyp + t2 * T.rr * 1.15), 0.82);
      }
      for (let k = 0; k < 24; k++) paintPx(Math.round(cxp + T.rr * 0.4), Math.round(cyp + T.rr + k), 0.8);
    }
  }
}

// grass at the footing + low shrub clumps: the base line of the film
function renderGround(age, fr) {
  for (let i2 = 0; i2 < 180; i2++) {
    const appear = 0.04 + 0.5 * h2(i2, 3);
    const grow = smoothstep(appear, appear + 0.25, age);
    if (grow <= 0) continue;
    const x0 = 14 + (W - 28) * h2(i2, 7);
    const baseY = 690 + 24 * h2(i2, 11);
    const hgt = (8 + 14 * h2(i2, 13)) * grow;
    const sway = Math.sin(fr * 0.36 + i2 * 1.9) * (1.2 + 2.8 * age);
    const dry = smoothstep(0.72, 0.95, age);
    const cr = lerp(58, 146, dry) + 14 * h2(i2, 17), cg = lerp(88, 126, dry), cb = lerp(46, 74, dry);
    for (let t = 0; t <= hgt; t++) {
      const xx = Math.round(x0 + sway * (t / hgt) * (t / hgt) * 2), yy = Math.round(baseY - t);
      if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
      blendPix(buf, xx, yy, cr, cg, cb, 0.45);
    }
  }
  for (const [sx2, sa] of [[318, 0.16], [1042, 0.22], [662, 0.19]]) {
    const grow = smoothstep(sa, sa + 0.4, age);
    if (grow <= 0) continue;
    const hw = 26 * grow, hh = 30 * grow, by = 692;
    for (let dy = -hh; dy <= 2; dy++) for (let dx = -hw; dx <= hw; dx++) {
      const xx = Math.round(sx2 + dx), yy = Math.round(by + dy);
      if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
      const r0 = Math.hypot(dx / hw, dy / hh);
      if (r0 > 1) continue;
      const k = smoothstep(0.95, 0.35, r0) * smoothstep(0.30, 0.62, fbm(xx / 6 + 23, yy / 6 + 17));
      if (k <= 0.02) continue;
      const gv = 0.7 + 0.5 * fbm(xx / 9 + 3, yy / 9 + 31);
      blendPix(buf, xx, yy, 44 * gv, 92 * gv, 40 * gv, k * 0.55);
    }
  }
}

function post(age, fr) {
  // film grain: builds through the first half of the run, then relaxes so the
  // late-century detail (graffiti gone, spall, mortar) isn't buried under noise.
  const gAmp = 4 + 9 * smoothstep(0.1, 0.55, age) * (1 - 0.5 * smoothstep(0.72, 1, age));
  const breath = 1 + 0.02 * Math.sin((fr / FPS) * (2 * Math.PI) / 11);
  const vigK = (0.62 + 0.34 * age) * breath;
  for (let y = 0; y < H; y++) {
    const dy = (y - H / 2) / (H / 2);
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2), d = Math.sqrt(dx * dx + dy * dy);
      const v = 1 - vigK * smoothstep(0.35, 1.25, d) * 0.85;
      const n = (h2(x + fr * 977, y + fr * 613) - 0.5) * gAmp * 2;
      const j = (y * W + x) * 3;
      buf[j] = pxv(buf[j] * v + n); buf[j + 1] = pxv(buf[j + 1] * v + n); buf[j + 2] = pxv(buf[j + 2] * v + n);
    }
  }
}

function renderHud(age, fr) {
  const t = fr / FPS;
  // year readout bottom-right, fades in/out on weather-band cuts (subtle flicker).
  // Right-aligned: measure the string and place its baseline so it reads cleanly.
  const yr = String(Math.floor(1926 + age * 100));
  const alpha = 0.5 + 0.4 * smoothstep(0.02, 0.08, age) * (1 - smoothstep(0.97, 1.0, age));
  const size = 34, tracking = 0.3;
  let wpx = 0;
  for (const ch of yr) { const g = glyphSegs(ch); wpx += (g.w + tracking) * size; }
  drawText(buf, yr, W - 80 - wpx, H - 70, size, tracking, 235, 232, 225, alpha);
}

function renderTitle(age) {
  const a = smoothstep(0.0, 0.06, age) * (1 - smoothstep(0.10, 0.16, age));
  if (a <= 0) return;
  const sizeT = 58, trackT = 0.4;
  let wT = 0; for (const ch of "THE WALL") { const g = glyphSegs(ch); wT += (g.w + trackT) * sizeT; }
  drawText(buf, "THE WALL", W / 2 - wT / 2, H / 2 + 20, sizeT, trackT, 240, 236, 228, a);
  const sizeS = 26, trackS = 0.5;
  let wS = 0; for (const ch of "1926-2026") { const g = glyphSegs(ch); wS += (g.w + trackS) * sizeS; }
  drawText(buf, "1926-2026", W / 2 - wS / 2, H / 2 + 78, sizeS, trackS, 220, 216, 208, a * 0.8);
  // two bystanders at the wall footing — a human presence with no faces,
  // only silhouettes. The film has no people; it just has the wall, and once
  // someone was standing in front of it.
  const drawFig = (fx, baseY, hgt, al) => {
    for (let y2 = baseY - hgt; y2 <= baseY; y2++) {
      const tt = (y2 - (baseY - hgt)) / hgt;
      let hw;
      if (tt < 0.22) { const d = Math.abs(tt - 0.11) / 0.11; hw = 4.6 * Math.sqrt(Math.max(0, 1 - d * d)); }
      else if (tt < 0.60) hw = 5.4 - 1.4 * (tt - 0.22);
      else hw = 4.2 * (1 - tt) + 1.2;
      for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) {
        const xx = Math.round(fx + dx), yy = Math.round(y2);
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        blendPix(buf, xx, yy, 20, 20, 22, al * (0.75 + 0.4 * h2(xx, yy)));
      }
    }
  };
  drawFig(Math.round(W * 0.665), 686, 72, 0.46 * a);
  drawFig(Math.round(W * 0.355), 690, 54, 0.32 * a);
}

// ---------------- audio synthesis (44.1k stereo s16) ----------------
function synthAudio() {
  const SR = 44100, N = Math.floor(SR * DUR);
  const L = new Float64Array(N), R = new Float64Array(N);
  let ph1 = 0, ph2 = 0, ph3 = 0, nzS = 0;
  // Scripted events, locked to the same ages as the picture:
  // two spray cans (the only human sound in the film - paint going on the wall,
  // 8.2s and 9.0s), dry mortar ticks climbing the century, masonry crashes at the
  // failure zones, and the last column going down in the closing second.
  const sprays = [8.22, 8.97];
  const ticks = [2.5, 3.7, 5.1, 6.3, 7.55, 8.6, 9.95, 11.3, 12.55, 13.6];
  // crash times sit inside the picture's failure windows (zone ages in voidOf),
  // and gains are set so each reads above the drone bed; the last column zone
  // starts at 0.955 (14.33s), so its thuds land 14.35 / 14.62 / 14.82
  const crashes = [[9.9, 0.34], [11.3, 0.38], [12.5, 0.36], [13.6, 0.42], [14.35, 0.48], [14.62, 0.52], [14.82, 0.45]];
  for (let i = 0; i < N; i++) {
    const t = i / SR, a = t / DUR;
    // drone: three detuned sine partials, slow swell with the century
    const sw = 0.12 + 0.16 * smoothstep(0, 1, a);
    ph1 += 2 * Math.PI * 55 / SR; ph2 += 2 * Math.PI * 82.4 / SR; ph3 += 2 * Math.PI * 110.2 / SR;
    const d = (Math.sin(ph1) * 0.5 + Math.sin(ph2) * 0.32 + Math.sin(ph3) * 0.2) * sw;
    // air/room floor: one-pole lowpassed - v2's raw white bed bit the ear at
    // full gain; this is film hiss, not static
    nzS = nzS * 0.86 + (h2(i, 7) - 0.5) * 0.3;
    let ev = 0, duck = 0;
    for (const e of sprays) {
      const dt = t - e;
      if (dt < 0 || dt >= 0.4) continue;
      const nz2 = h2(i, 911) - 0.5;
      const env = dt < 0.015 ? (dt / 0.015) * 0.34 : 0.3 * Math.exp(-(dt - 0.015) * 8.5);
      // can click + band-sniffed hiss body + rattle
      ev += nz2 * 1.4 * env + Math.sin(2 * Math.PI * 5900 * t) * 0.05 * Math.exp(-dt * 15) + nz2 * Math.sin(dt * 290) * 0.05;
      duck += env * 3.2;
    }
    for (const e of ticks) {
      const dt = t - e;
      if (dt < 0 || dt >= 0.14) continue;
      const env = Math.exp(-dt * 65);
      ev += (h2(i, 31) - 0.5) * env * 0.42 + Math.sin(2 * Math.PI * 230 * dt) * env * 0.05 + Math.sin(2 * Math.PI * 3400 * dt) * env * 0.03;
      duck += env * 0.5;
    }
    for (const [e, gn] of crashes) {
      const dt = t - e;
      if (dt < 0 || dt >= 0.8) continue;
      const env = Math.exp(-dt * 4.5);
      const body = Math.sin(2 * Math.PI * (47 + 6 * Math.sin(dt * 33)) * dt) * 0.85;
      ev += ((h2(i, 151) - 0.5) * 0.9 + body) * env * gn + (h2(i, 157) - 0.5) * Math.exp(-dt * 12) * 0.10;
      duck += env * gn * 2.6;
    }
    const nz = nzS * 0.026 * (0.35 + 0.5 * a) * (1 - Math.min(0.85, duck));
    // the drone partials duck under events too (v2's problem: a constant
    // drone masked everything within 1-2 dB)
    const dduck = 1 - Math.min(0.72, duck * 0.42);
    // sparse ticking: mortar grit dropping off (weather events), deterministic per band
    let tick = 0;
    for (const b of bands) {
      if (a > b.t0 && a < b.t1 && b.kind === 0) {
        const p = ((i / SR * 7 + b.t0 * 997) | 0);
        if (h2(p, 31) < 0.0006) tick += (h2(p, 57) - 0.5) * 0.28;
      }
    }
    // creak: slow amplitude-modulated low rumble accent
    const creak = Math.sin(2 * Math.PI * 31 * t) * 0.04 * smoothstep(0.3, 0.6, a) * (0.5 + 0.5 * Math.sin(t * 0.7));
    const s = d * dduck + nz + tick + creak + ev;
    L[i] = s * 0.9; R[i] = s * 0.82;
  }
  // fade in/out (short tail: crashes ride the fade, the bed ducks under them)
  for (let i = 0; i < SR * 1.2 && i < N; i++) { const k = i / (SR * 1.2); L[i] *= k; R[i] *= k; }
  for (let i = 0; i < SR * 0.45 && i < N; i++) { const j = N - 1 - i, k = i / (SR * 0.45); L[j] *= k; R[j] *= k; }
  // WAV
  const bytes = 44 + N * 4;
  const wb = Buffer.alloc(bytes);
  // Canonical 44-byte RIFF/WAVE header: fmt chunk at 12, data chunk at 36,
  // sample data at 44. (Writing fmt at 16 left NULs at 12 and ffmpeg rejected it.)
  wb.write("RIFF", 0); wb.writeUInt32LE(bytes - 8, 4); wb.write("WAVE", 8);
  wb.write("fmt ", 12); wb.writeUInt32LE(16, 16); wb.writeUInt16LE(1, 20); wb.writeUInt16LE(2, 22);
  wb.writeUInt32LE(SR, 24); wb.writeUInt32LE(SR * 4, 28); wb.writeUInt16LE(4, 32); wb.writeUInt16LE(16, 34);
  wb.write("data", 36); wb.writeUInt32LE(N * 4, 40);
  let o = 44;
  for (let i = 0; i < N; i++) {
    wb.writeInt16LE(clamp(Math.round(L[i] * 32767), -32768, 32767), o); o += 2;
    wb.writeInt16LE(clamp(Math.round(R[i] * 32767), -32768, 32767), o); o += 2;
  }
  writeFileSync(`${DIR}/audio.wav`, wb);
}

// ---------------- main loop ----------------
function writePPM(name) {
  // "P6\n1280 720\n255\n" is 16 ASCII bytes, not 15 — the old 15-byte alloc
  // clobbered the header's final newline with the first pixel byte, which made
  // the PPM decoder reject every frame.
  const HDR = "P6\n1280 720\n255\n";
  const ppm = Buffer.alloc(HDR.length + W * H * 3);
  ppm.write(HDR, 0);
  const off = Buffer.byteLength(HDR, "ascii");
  for (let i2 = 0; i2 < buf.length; i2++) ppm[off + i2] = buf[i2];
  writeFileSync(name, ppm);
}

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
if (!existsSync(`${DIR}/frames`)) mkdirSync(`${DIR}/frames`, { recursive: true });
const list = [];
for (let fr = 0; fr < FRAMES; fr++) {
  const age = fr / (FRAMES - 1);
  buf.fill(0);
  renderWall(age, fr);
  renderGraffiti(age);
  renderPlant(plant, age);
  renderPlant(plant2, age);
  renderPlant(plant3, age);
  renderGround(age, fr);
  post(age, fr);
  renderHud(age, fr);
  if (fr < FPS * 2.4) renderTitle(age);
  writePPM(`${DIR}/frames/f${String(fr).padStart(4, "0")}.ppm`);
  list.push(`file 'frames/f${String(fr).padStart(4, "0")}.ppm'`);
  if (fr % 75 === 0) console.log(`${fr}/${FRAMES}`);
}
writeFileSync(`${DIR}/list.txt`, list.join("\n"));
synthAudio();
console.log("render done");
