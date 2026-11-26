// Render gate for the Nakatomi Plaza show: load the built page, then assert the
// rendered END STATE of six named views instead of looking at a screenshot and
// hoping. ui-verify.mjs owns the full-take run (every beat, every frame); this
// gate is the pixel-level proof for six named framings, each one frozen with
// setFraming/setPose so the numbers are reproducible:
//
//   1. boulevard wide    t=0            the dusk sky colour, the whole massing
//   2. shaft close-up    blast          curtain wall fills the frame (no fx here)
//   3. lobby flash       365            the blast flash reaches the screen
//   4. lobby storm       437            panes + shards reach the screen
//   5. convoy wall       fedConvoy      the responders' lightbars reach the screen
//   6. over the deck     rooftopGlow    the warm glow reads at the top of the take
//
// Every view must also show: voxels > 0 and a clean palette gate, a legal lens
// (envelope.isOutside on the actual camera), and no full-bleed content fill -
// a witness frame that WAS the glass is the breach that pixel reads can catch
// (R12). The dusk sky gate asserts the top rows read the clear colour exactly
// as it arrives on the sensor: measured on the live back buffer, the encoded
// clear lands as raw #0a0c12 (10, 12, 18) with no dither, so the gate compares
// those bytes, tolerance only for downscale blend on rows near the skyline.
//
// Needs the `agent-browser` CLI on PATH (real Chromium; the page sets
// preserveDrawingBuffer: true so the back buffer can be read back).
//
// Usage:  node tools/render-gate.mjs [path/to/index.html]
// Exit:   0 green / 1 red.

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";

const file = resolve(process.argv[2] || "index.html");
const dir = dirname(file);
const url = pathToFileURL(file).href;
const run = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim();
// Same transport as ui-verify: payload over stdin, no argv quoting through cmd.exe.
const evalJs = (js) => decode(run(`agent-browser eval --stdin`, { input: js }));
const decode = (raw) => {
  let v = JSON.parse(raw);
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { /* a plain page string stays a string */ }
  }
  return v;
};

// --- bars, all set from measured values (probe runs, 2026-11-26) -------------
// top 3 scan rows of every legal view are sky: measured skyFrac 0.83-1.00, so
// the bar sits under the worst read and well above a frame with no sky at all.
const MIN_SKY_FRAC = 0.55;
const MIN_SKY_WIDE = 0.9;       // view 1 measured 1.00: the establishing shot is all sky
const SKY_RGB = [10, 12, 18];   // #0a0c12 as measured on the back buffer, no encode
const SKY_TOL = 6;              // per channel, so downscale blend near the skyline stays out
// The shatter id (#e8f4ff) is the only near-white in the dusk palette. Strict
// signature: measured 0 pale in quiet frames, 46-50 inside the fx windows; a
// baseline of AA-blent glow edges reads 4-6, so the delta bar sits under what
// the burst actually adds and far above any baseline.
const MIN_PALE_DELTA = 30;
const MIN_LIGHT_PIXELS = 12;    // same floor as ui-verify's convoy bar (measured 78 here)
const MAX_FRAC_FILL = 0.9;      // witness frames must not be a full-bleed fill
const MIN_TOWER_FRAC = 0.08;    // the tower must be in frame, any view
const MIN_SHAFT_FRAC = 0.2;     // the shaft view measured 0.284 content: curtain wall only

// The fedConvoy witness lens: the same legal pose ui-verify's convoy probe uses
// (the four fixed framings orbit the tower, and the cruiser wall stands in the
// forecourt behind the massing from there), so both tools review the same frame.
const CONVOY_POSE = { pos: { x: -14, y: 12, z: 46 }, target: { x: 0, y: 2, z: 21 }, fov: 45 };

run(`agent-browser open ${JSON.stringify(url)}`);
run(`agent-browser wait 800`); // settle; NOT `wait --idle` - always times out on file:// pages

// The page is an ES module; wait for the boot object rather than guessing at a delay.
for (let i = 0; i < 40; i++) {
  const ready = evalJs(`(() => !!(window.NAKATOMIC && window.NAKATOMIC.clock))()`);
  if (ready) break;
  run(`agent-browser wait 250`);
}

// One synchronous payload: the loop is paused, and every view is one painted
// step(0) frame, so no rAF frame interleaves between a seek and its sample.
const report = evalJs(`(() => {
  const N = window.NAKATOMIC;
  if (!N.scene) return JSON.stringify({ fatal: "NAKATOMIC.scene missing - the render rig is not wired" });
  // The gate must not boot the page it is gating: a tool that calls start() for the
  // page cannot see the page failing to boot, and that is the bug this gate used to
  // miss. The page's own DOMContentLoaded hook has already run by the time the load
  // event lets this payload execute.
  if (!N.scene.running)
    return JSON.stringify({ fatal: "the page never booted itself - a browser open would show the static shell" });
  N.scene.togglePause();                       // the tool owns the clock; the loop only repaints
  const gl = N.scene.gl;
  const canvas = gl && gl.domElement;
  if (!canvas || !canvas.width) return JSON.stringify({ fatal: "the renderer did not size a canvas" });

  const bg = [10, 12, 18];                     // #0a0c12: the page colour and the clear colour
  const sky = ${JSON.stringify(SKY_RGB)};
  const tol = ${SKY_TOL};
  const look = (sw = 96, sh = 54) => {
    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    const g2 = c.getContext("2d", { willReadFrequently: true });
    g2.drawImage(canvas, 0, 0, sw, sh);
    const d = g2.getImageData(0, 0, sw, sh).data;
    let tower = 0, warm = 0, cool = 0, pale = 0, red = 0, blue = 0, skyOk = 0, skyBad = 0;
    let r0 = sh, r1 = -1, c0 = sw, c1 = -1;
    const total = sw * sh;
    for (let px = 0; px < total; px++) {
      const i = px * 4;
      const off = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
      if (off > 24) {
        tower++;
        const row = (px / sw) | 0, col = px % sw;
        if (row < r0) r0 = row;
        if (row > r1) r1 = row;
        if (col < c0) c0 = col;
        if (col > c1) c1 = col;
      }
      if (d[i] > 110 && d[i] > d[i + 2] + 25) warm++;
      // The shatter id (#e8f4ff) is the only near-white in the dusk palette:
      // strict signature measured at 0 in quiet frames, 46-50 inside the fx
      // windows. (The loose cool signature runs over 700 in a quiet lobby frame
      // because AA on the lit glass reads cool too - which is why the burst is
      // counted with this stricter one, and the loose one stays for reporting.)
      if (d[i] > 90 && d[i + 1] > 100 && d[i + 2] > 120 && d[i + 2] >= d[i] - 6) cool++;
      if (d[i] > 150 && d[i + 1] > 170 && d[i + 2] > 190) pale++;
      if (d[i] > 110 && d[i + 1] < 90 && d[i + 2] < 90) red++;
      if (d[i] < 140 && d[i + 2] > 150 && d[i + 2] > d[i] + 60 && d[i + 2] > d[i + 1] + 40) blue++;
      // The top three rows are sky in every legal framing (ui-verify's framing 1
      // gate already proves the roofline clears the top of the frame), so they are
      // the dusk-sky read: each must sit on the clear colour exactly as measured
      // on the back buffer (#0a0c12 raw, no dither over the sky rows).
      if (((px / sw) | 0) < 3) {
        const ok = Math.abs(d[i] - sky[0]) <= tol && Math.abs(d[i + 1] - sky[1]) <= tol
          && Math.abs(d[i + 2] - sky[2]) <= tol;
        if (ok) skyOk++; else skyBad++;
      }
    }
    const boxH = r1 >= r0 ? (r1 - r0 + 1) / sh : 0;
    const boxW = c1 >= c0 ? (c1 - c0 + 1) / sw : 0;
    const rows = 3 * sw;
    return {
      tower, warm, cool, pale, red, blue, total, towerFrac: tower / total,
      boxH, boxW, boxTop: r0,
      skyFrac: skyOk / rows, skyBad,
    };
  };

  // A frame frozen inside a time window: seek to the beat, crawl to an absolute
  // t, then paint exactly that clock instant. The crawl stays clear of the wrap,
  // so it never crosses 735.25 and the pose the tool pins is deterministic.
  const seekExact = (target) => {
    let id = N.clock.order[0];
    for (const b of N.clock.BEATS) if (b.start <= target) id = b.id;
    N.clock.seekTo(id);
    let guard = 0;
    while (N.clock.t < target - 1e-9 && guard++ < 40000) N.clock.tick(0.05);
    return N.clock.t;
  };

  const views = [];
  const shoot = (name, quiet) => {
    const fr = N.scene.step(0);                        // paint exactly the clock's t
    const cam = N.scene.camera.position;
    const t = fr.t;
    const v = {
      name, t,
      beat: N.clock.beatAt(t) && N.clock.beatAt(t).id,
      label: document.getElementById("beat").textContent,
      source: N.scene.cameraSource,
      outside: N.envelope.isOutside({ x: cam.x, y: cam.y, z: cam.z }),
      fov: Number(N.scene.camera.fov.toFixed(2)),
      fade: Number(getComputedStyle(document.getElementById("fade")).opacity),
      fx: N.scene.stats.fx, fxCells: N.fx.at(t).length,
      pixels: look(240, 135),
    };
    if (quiet) {
      v.quietT = quiet.t; v.quietPale = quiet.pale; v.quietFx = quiet.fx;
    }
    views.push(v);
    return v;
  };
  // The same lens the next view will use, one step outside the fx window: the
  // baseline the burst delta is measured against. Painted before the window can
  // reach it, and the fx never drew (stats.fx 0), so the baseline is clean.
  const quietAt = () => {
    const fr = N.scene.step(0);
    return { t: fr.t, pale: look(240, 135).pale, fx: N.scene.stats.fx };
  };

  // 1. boulevard wide at t=0: the establishing frame, all sky and massing.
  N.clock.seekTo(N.clock.order[0]);
  N.scene.setFraming(1);
  shoot("boulevard wide");

  // 2. the mid-shaft close-up: a framing that fills the frame with curtain wall
  // but carries no fx expectation - the break lives at storey bands 5..8 on the
  // atrium face (S.z0), which this lens aims past, so the shaft view is the
  // structural proof (massing + sky + a frame that is not a full-bleed fill).
  N.clock.seekTo("blast");
  N.scene.setFraming(2);
  shoot("shaft close-up");

  // 3+4. lobby level: the atrium face fills this frame, so both fx windows read
  // here - the blast flash inside [360,390) and the mid-storm burst inside
  // [390,485), each against one clean baseline. The baseline sits at 359, one
  // step before the flash opens: the fx draws nowhere outside its windows (R15),
  // so the quiet frame has no burst in it to subtract.
  N.scene.setFraming(3);
  seekExact(N.fx.flashWindow[0] - 1);                   // 359
  const quietLobby = quietAt();
  seekExact(N.fx.flashWindow[0] + 5);                   // 365: inside the flash window
  N.scene.setFraming(3);
  shoot("lobby flash", quietLobby);
  seekExact(N.fx.window[0] + 47);                       // 437: mid-storm, panes and shards
  N.scene.setFraming(3);
  shoot("lobby storm", quietLobby);

  // 5. the fed convoy: the wall of cruisers is world geometry (R19), so the
  // proof is the lightbars' own paint landing through a legal witness lens.
  N.clock.seekTo("fedConvoy");
  N.clock.tick(10);
  N.scene.setPose(${JSON.stringify(CONVOY_POSE)});
  shoot("convoy wall");

  // 6. over the deck at the top of the take: the lobby glow has to still read
  // in the last lit beats before the hold.
  N.clock.seekTo("rooftopGlow");
  N.scene.setFraming(4);
  shoot("over the deck");

  // Global proofs: the cloud is real, and the palette never crossed its line.
  let gateErr = null;
  try { N.palette.gate(); } catch (e) { gateErr = String(e && e.message || e); }
  N.scene.togglePause();                               // hand the clock back to the loop
  return JSON.stringify({
    canvas: { w: canvas.width, h: canvas.height },
    bufferVoxels: N.vox.count,
    points: N.scene.stats.points,
    statsVoxels: N.scene.stats.voxels,
    gateErr,
    views,
  });
})()`);

// --- screenshots for review, one per named view (artifacts, not history). ----
// Same poses as the gated views above: a screenshot is only worth having if it
// is the exact frame the numbers were read from.
const SHOTS = [
  ["boulevard wide", `N.clock.seekTo(N.clock.order[0]); N.scene.setFraming(1);`],
  ["shaft close-up", `N.clock.seekTo("blast"); N.scene.setFraming(2);`],
  ["lobby flash", `N.clock.seekTo("blast"); while (N.clock.t < 365) N.clock.tick(0.05); N.scene.setFraming(3);`],
  ["lobby storm", `N.clock.seekTo("storm"); while (N.clock.t < 437) N.clock.tick(0.05); N.scene.setFraming(3);`],
  ["convoy wall", `N.clock.seekTo("fedConvoy"); N.clock.tick(10); N.scene.setPose(${JSON.stringify(CONVOY_POSE)});`],
  ["over the deck", `N.clock.seekTo("rooftopGlow"); N.scene.setFraming(4);`],
];
const shots = [];
for (const [name, setup] of SHOTS) {
  evalJs(`(() => { const N = window.NAKATOMIC; ${setup} N.scene.step(0); return "painted"; })()`);
  const png = join(dir, "render-gate", `${name.replace(/ /g, "-")}.png`);
  mkdirSync(dirname(png), { recursive: true });
  run(`agent-browser screenshot ${JSON.stringify(png)}`);
  const size = existsSync(png) ? statSync(png).size : 0;
  shots.push({ name, png, size });
}

for (const v of report.views || []) console.log(JSON.stringify(v));
console.log(JSON.stringify({
  bufferVoxels: report.bufferVoxels, points: report.points, statsVoxels: report.statsVoxels,
  gateErr: report.gateErr,
  shots: shots.map((s) => `${s.png} (${s.size} bytes)`).join(", "),
}));

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
check(!report.fatal, report.fatal || "boot");
if (!report.fatal) {
  check(report.bufferVoxels > 0, `the shared buffer holds voxels: got ${report.bufferVoxels}`);
  check(report.points === report.bufferVoxels && report.statsVoxels === report.bufferVoxels,
    `the cloud drew every voxel: points ${report.points}, stats ${report.statsVoxels}, buffer ${report.bufferVoxels}`);
  check(report.gateErr === null, `the palette gate is clean: ${report.gateErr}`);

  for (const v of report.views) {
    const p = v.pixels;
    check(v.t > 0 || v.name === "boulevard wide", `${v.name}: the view painted at t=${v.t}`);
    check(v.outside === true, `${v.name}: the witness lens is inside the tower envelope`);
    check(v.fade === 0, `${v.name}: the fade overlay is up at t=${v.t}, got ${v.fade}`);
    check(v.label, `${v.name}: the HUD names the beat, got ${JSON.stringify(v.label)}`);
    check(p.towerFrac >= MIN_TOWER_FRAC && p.towerFrac <= MAX_FRAC_FILL,
      `${v.name}: the frame is neither empty (${(p.towerFrac * 100).toFixed(1)}%) nor a full-bleed `
      + `fill (${(p.towerFrac * 100).toFixed(1)}% content): R12 says a breach would fill the frame`);
    check(p.skyFrac >= MIN_SKY_FRAC,
      `${v.name}: the dusk sky reads #${SKY_RGB.map((c) => c.toString(16).padStart(2, "0")).join("")} `
      + `up top: ${(p.skyFrac * 100).toFixed(1)}% of the top rows on it, ${p.skyBad} off it`);
  }

  check(report.views[0].pixels.skyFrac >= MIN_SKY_WIDE,
    `view 1 (boulevard wide) is mostly dusk sky: top rows ${(report.views[0].pixels.skyFrac * 100).toFixed(1)}% on colour`);
  check(report.views[0].pixels.boxTop >= 3 && report.views[0].pixels.boxH >= 0.6,
    `view 1 shows the massing under sky: box starts row ${report.views[0].pixels.boxTop}, `
    + `spans ${(report.views[0].pixels.boxH * 100).toFixed(1)}% of the height`);

  // The two lobby frames carry the shatter id: the pale signature is the only
  // near-white in the dusk palette, and the delta against the same lens one step
  // outside the fx window is the burst itself reaching the sensor. The baseline
  // frame must be fx-free - the overlay draws nowhere outside its windows (R15),
  // so there is never a burst in it to subtract.
  const byName = Object.fromEntries(report.views.map((v) => [v.name, v]));
  for (const name of ["lobby flash", "lobby storm"]) {
    const v = byName[name];
    check(v.quietFx === 0,
      `${name}: the baseline frame at t=${v.quietT} must be fx-free, got ${v.quietFx} drawn`);
    check(v.fx > 0 && v.fxCells > 0 && v.fx === v.fxCells,
      `${name}: the overlay drew ${v.fx} of ${v.fxCells} fx cells at t=${v.t}`);
    check(v.pixels.pale - v.quietPale >= MIN_PALE_DELTA,
      `${name}: the shatter id reaches the screen: ${v.pixels.pale} pale pixels vs ${v.quietPale} quiet `
      + `at t=${v.quietT} (needs +${MIN_PALE_DELTA})`);
  }
  check(byName["shaft close-up"].beat === "blast",
    `the shaft close-up sits on the blast beat, got ${JSON.stringify(byName["shaft close-up"].beat)}`);
  check(byName["shaft close-up"].pixels.towerFrac >= MIN_SHAFT_FRAC,
    `the shaft close-up fills the frame with curtain wall: ${(byName["shaft close-up"].pixels.towerFrac * 100).toFixed(1)}% content`);

  const fed = byName["convoy wall"];
  check(fed.beat === "fedConvoy" || fed.beat === "wallOfCars",
    `the convoy witness sits on a fed beat, got ${JSON.stringify(fed.beat)}`);
  check(fed.fx === 0 && fed.fxCells === 0,
    `the fed witness has no fx overlay drawing ${fed.fx} cells at t=${fed.t}`);
  check(fed.pixels.red + fed.pixels.blue >= MIN_LIGHT_PIXELS,
    `the convoy's lightbars reach the screen: ${fed.pixels.red}/${fed.pixels.blue} red/blue pixels`);

  const deck = byName["over the deck"];
  check(deck.pixels.warm > 0, `the lobby glow still reads over the deck at t=${deck.t}, got ${deck.pixels.warm} warm`);
  check(deck.beat === "rooftopGlow" || deck.beat === "drestle",
    `the deck witness sits on the last lit beats, got ${JSON.stringify(deck.beat)}`);
}

const errs = run("agent-browser errors").trim();
if (errs) {
  console.log(`console errors: ${errs}`);
  fails.push(`page reported console errors: ${errs}`);
}

if (fails.length) {
  console.error("RENDER GATE FAIL:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log(`render-gate: ${report.views.length} views pixel-gated; `
  + `${report.bufferVoxels} voxels as ${report.points} points; sky ${SKY_RGB.join(",")} +-${SKY_TOL}; end state good`);
