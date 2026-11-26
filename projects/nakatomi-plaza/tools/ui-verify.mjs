// ui-verify: drive the built page to a finished state, then assert the END STATE.
//
// Core adapted from the AGENTS.md `ui-verify` protocol. The rule that protocol exists to
// enforce: never check symptoms (CSS classes, counter values) when you can check the data
// the page is supposed to end up in. So this script loads index.html in a real browser,
// drives the clock the way the render loop would, and asserts the clock's end state -
// where the blast beat lands, when full black happens, and how many times the loop wraps.
//
// Usage:  node tools/ui-verify.mjs [path/to/index.html]
// Exit:   0 green / 1 red, in seconds.

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";

const file = resolve(process.argv[2] || "index.html");
const dir = dirname(file);
const url = pathToFileURL(file).href;
const run = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim();
// Payload goes to the CLI over stdin (--stdin), not in argv: the scene probe is a few
// KB of JavaScript, and a base64 argv runs into the Windows command-line limit (~8 KB
// through cmd.exe), so the whole run dies before the page sees a line of it. stdin has
// no length limit and no shell layer to reinterpret quotes, $ or backslashes.
const evalJs = (js) => decode(run(`agent-browser eval --stdin`, { input: js }));
// The CLI JSON-encodes whatever the page returned, so a JSON string returned by the page
// arrives double-encoded: one parse for the CLI wrapper, one more for the payload.
const decode = (raw) => {
  let v = JSON.parse(raw);
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { /* a plain page string stays a string */ }
  }
  return v;
};

// --- pixel assertions -------------------------------------------------------
// A rendered frame must show the tower, not just a canvas. The 96x54 scan of the
// live WebGL surface counts off-background pixels and their bounding box: the wide
// shot covers far more than the tower's silhouette (plaza, skyline, garage), so the
// bars are set from what a real frame contains rather than a CSS symptom.
const MIN_TOWER_FRAC = 0.08;
const MIN_TOWER_WIDE = 0.18;   // framing 1 only: the establishing shot
const MIN_BOX_H = 0.6;         // framing 1 only: the massing spans the frame's height
const BOX_TOP_MARGIN = 2;      // framing 1 only: sky rows above the roofline
// The overlay's floor: the cool pixels a burst has to add over a frame the same
// lens sees without it. Set well below what a real frame measures, so it catches
// a missing overlay without tracking the last pixel.
const MIN_OVERLAY_PIXELS = 8;
// The convoy's floor: pixels of the two responder-light hexes, counted inside the
// fed beats. Set below what a real frame measures and above what a plaza with no
// response measures, so the bar catches a batch that never reached the cloud.
const MIN_LIGHT_PIXELS = 12;
// --- the take's own camera, asserted against the camera the page renders with.
// The lens has to stay outside the envelope on every frame (R12), the fov inside
// the rig's clamp every frame (no zoom lenses), and consecutive frames have to be
// dollies rather than cuts. The step bar is cells per clamped frame at dtClamp
// 0.25: a real cut moves tens of cells, while the fastest dolly the take makes is
// the blast beat's descent at about 13 cells/s - observed at 3.15 cells a frame,
// so the bar sits a quarter above that and far below a cut.
const MAX_RIG_STEP_CELLS = 4;
// Every beat's first painted frame has to have the tower in it: a beat the take
// cannot see is a beat the show does not witness. Observed minimum is the sky push
// at 10% of the frame, so the bar catches a lens aimed at blank sky.
const MIN_RIG_TOWER_FRAC = 0.05;
// Bars sit below what a real frame measures, not guesses: framing 1 was 21.7% content
// (towerFrac), a content box 94% of the frame height starting at row 3, and 41 warm
// pixels; framings 2..4 measured 0.14-0.26 towerFrac with 38-74 warm. Retune these from
// a fresh run whenever a framing changes - the screenshots beside the bars are the proof.
// The frame pair we review by eye: one wide, one close, both mid-show and before
// any fade overlay.
const FRAMINGS_SHOTS = [
  [1, "storm", "boulevard-wide"],
  [2, "blast", "tower-close"],
  [3, "storm", "shatter-lobby"],
];
// A review frame of the response, and the same witness lens the convoy gate probes
// with: the four fixed framings orbit the tower and the wall of cruisers stands
// behind the massing, so this beat needs its own legal pose until Task 12's rig
// carries one. Same pose as the probe, so the screenshot and the numbers match.
const POSE_SHOTS = [
  ["fedConvoy", "convoy-wall", { x: -14, y: 12, z: 46 }, { x: 0, y: 2, z: 21 }, 45],
];
// Review frames from the take's own lens. Task 12's rig carries a leg for every
// beat, so these shots are driven through the loop (unpaused, step by step) rather
// than pinned with setFraming: what a viewer of the show actually sees.
const RIG_SHOTS = [
  ["open", 0.5, "rig-open"],
  ["limoNakatomi", 0.6, "rig-limo"],
  ["archWalk", 0.6, "rig-arch"],
  ["treeSet", 0.5, "rig-tree"],
  ["gunRun", 0.5, "rig-gunrun"],
  ["blast", 0.5, "rig-blast"],
  ["storm", 0.4, "rig-storm"],
  ["wallOfCars", 0.5, "rig-wall-of-cars"],
  ["plazaWide", 0.5, "rig-plaza-wide"],
  ["skyPush2", 0.5, "rig-sky-push"],
];

run(`agent-browser open ${JSON.stringify(url)}`);
run(`agent-browser wait 800`); // settle; NOT `wait --idle` - always times out on file:// pages

// The page is an ES module; wait for the boot object rather than guessing at a delay.
for (let i = 0; i < 40; i++) {
  const ready = evalJs(`(() => !!(window.NAKATOMIC && window.NAKATOMIC.clock))()`);
  if (ready) break;
  run(`agent-browser wait 250`);
}

// --- Drive: seek to the blast beat, then run the whole show one clamped frame at a time.
const report = evalJs(`(() => {
  const N = window.NAKATOMIC, c = N && N.clock;
  if (!c) return JSON.stringify({ fatal: "NAKATOMIC.clock missing - module did not boot" });

  const seeked = { id: c.seekTo("blast"), label: c.beatAt(c.t) && c.beatAt(c.t).id };

  let blackAt = null, wrappedAt = null, wraps = 0, frames = 0;
  for (let i = 0; i < 5000 && wraps === 0; i++) {
    const prevT = c.t;           // the tick reports t after any reset, so keep the frame time
    const r = c.tick(c.dtClamp);
    frames++;
    if (blackAt === null && c.fade.black === 1) blackAt = prevT + c.dtClamp;
    if (r.wrapped) wrappedAt = prevT;
    wraps += r.wrapped ? 1 : 0;
  }

  return JSON.stringify({
    seeked,
    blackAt,
    wrappedAt,
    wraps,
    frames,
    afterWrap: c.t,
    wrapAt: c.wrapAt,
    showLen: c.SHOW_LEN,
    dtClamp: c.dtClamp,
    holdLabel: c.beatAt(c.SHOW_LEN - 1),
    // The fade element itself is asserted in the scene payload below, once the
    // render rig exists - checking it here would only ever read the CSS default.
  });
})()`);

// --- The render rig: what the page actually paints (Task 7.5). One synchronous
// payload, so no rAF frame can interleave between the seek and the sample: the
// loop is paused, and step(0) paints one frame from the clock's current time.
const sceneReport = evalJs(`(() => {
  const N = window.NAKATOMIC;
  if (!N.scene) return JSON.stringify({ fatal: "NAKATOMIC.scene missing - the render rig is not wired" });
  // The driver must not boot the page it is driving: a tool that calls start() for the
  // page cannot see the page failing to boot, which is exactly the bug that left a
  // black screen in a plain browser open while every gate read green. The page's own
  // DOMContentLoaded hook has run before the load event lets this payload execute.
  if (!N.scene.running)
    return JSON.stringify({ fatal: "the page never booted itself - a browser open would show the static shell" });
  N.scene.togglePause();                 // the tool owns the clock; the loop only repaints
  const gl = N.scene.gl;
  const canvas = gl && gl.domElement;
  if (!canvas || !canvas.width) return JSON.stringify({ fatal: "the renderer did not size a canvas" });

  const bg = [10, 12, 18];               // #0a0c12: the page colour and the clear colour
  // Down-scale the live canvas into a small 2D surface and read it once: one
  // getImageData covers the whole frame instead of 75 lucky-pixel guesses.
  const look = (sw = 96, sh = 54) => {
    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    const g2 = c.getContext("2d", { willReadFrequently: true });
    g2.drawImage(canvas, 0, 0, sw, sh);
    const d = g2.getImageData(0, 0, sw, sh).data;
    let tower = 0, warm = 0, cool = 0, red = 0, blue = 0;
    let r0 = sh, r1 = -1, c0 = sw, c1 = -1;
    const total = sw * sh;
    // One linear index over the scan, and the row/column derived from it. The box is
    // in scan rows and columns, so boxTop is rows of sky and boxH is rows of content -
    // not a run of bytes divided by the wrong dimension, which is what a pixel-offset
    // span looks like when it happens to fall inside the frame.
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
      // A warm pixel: the lobby/glass glow is amber, and even when downscaling
      // blends it with the dark glass beside it, red still beats blue by a margin.
      if (d[i] > 110 && d[i] > d[i + 2] + 25) warm++;
      // A bright, cool pixel: the only thing in the show that pale and cold - the
      // dusk palette is warm amber and deep blue-grey, so this is the shatter id.
      if (d[i] > 90 && d[i + 1] > 100 && d[i + 2] > 120 && d[i + 2] >= d[i] - 6) cool++;
      // Responder light: the convoy's lightbars are the only saturated red and the
      // only saturated blue in the palette. Both signatures are set so nothing else
      // in the dusk scene can match - the fountain's #7fb2d8 spray is pale blue, not
      // saturated, and the lobby glow is amber. The bars stay below what a real frame
      // measures, above what a scene without the convoy measures (which is 0).
      if (d[i] > 110 && d[i + 1] < 90 && d[i + 2] < 90) red++;
      if (d[i] < 140 && d[i + 2] > 150 && d[i + 2] > d[i] + 60 && d[i + 2] > d[i + 1] + 40) blue++;
    }
    // The content bounding box, in scan rows/columns: what the framing actually
    // contains. A wide shot whose content touches the top row is a tower clipped at
    // the roofline, and a box that spans too little of the frame is a dot in the
    // middle of it. The bottom row is expected to clip: the ground plane runs all the
    // way to the lens, so the lot edge is always out of frame in a wide shot.
    const boxH = r1 >= r0 ? (r1 - r0 + 1) / sh : 0;
    const boxW = c1 >= c0 ? (c1 - c0 + 1) / sw : 0;
    return {
      tower, warm, cool, red, blue, total, towerFrac: tower / total, warmFrac: warm / total,
      boxH, boxW, boxTop: r0, boxBottom: r1, boxLeft: c0, boxRight: c1,
    };
  };

  const views = [];
  N.clock.seekTo("storm");                        // a deterministic mid-show time
  for (let f = 1; f <= 4; f++) {
    N.scene.setFraming(f);
    const fr = N.scene.step(0);                   // one painted, HUD-updated frame
    const cam = N.scene.camera.position;
    views.push({
      framing: f,
      label: document.getElementById("beat").textContent,
      fade: Number(getComputedStyle(document.getElementById("fade")).opacity),
      t: fr.t,
      clockLabel: fr.beat && fr.beat.label,
      outside: N.envelope.isOutside({ x: cam.x, y: cam.y, z: cam.z }),
      pixels: look(),
    });
  }

  const fx = (function probeFx() {
    // The overlay's real test: same framing, same camera, two clock positions.
    // The rig is not per-beat yet (Task 12), so setFraming pins the lens and the
    // only difference between the two frames is what the fx drew. A cool-pixel
    // delta is therefore the burst reaching the screen, not a counter reading.
    // The break lives on the atrium face at storey bands 5..8, so the framing that
    // can see it is the lobby-level pass, not the mid-shaft close-up.
    N.scene.setFraming(3);
    const seekTime = (target) => {
      let id = N.clock.order[0];
      for (const b of N.clock.BEATS) if (b.start <= target) id = b.id;
      N.clock.seekTo(id);
      let guard = 0;
      while (N.clock.t < target - 1e-9 && guard++ < 40000) N.clock.tick(0.05);
      return N.clock.t;
    };
    const snap = (target) => {
      const t = seekTime(target);
      const fr = N.scene.step(0);              // the frame has to be painted at this t
      // The overlay pixels are small splats, so the probe scans at 240x135 rather
      // than the 96x54 the framings use: a splat that covers a third of a scan
      // pixel in the coarse scan is a whole one in the fine scan.
      const px = look(240, 135);
      return { t: fr.t, cool: px.cool, drawn: N.scene.stats.fx, cells: N.fx.at(fr.t).length };
    };
    // one frame before either window opens, and instants inside each: the overlay
    // is on the clock's terms, and only the clock's terms, all the way to the pixel
    const quiet = snap(N.fx.flashWindow[0] - 1);       // 359: before the blast beat
    const endQ = snap(N.fx.window[1]);                 // the storm's half-open end
    const mid = snap(N.fx.window[0] + 47);             // mid-storm: panes and shards
    const flash = snap(N.fx.flashWindow[0] + 5);       // inside the blast beat
    return {
      quiet, endQ, mid, flash,
      delta: mid.cool - quiet.cool, flashDelta: flash.cool - quiet.cool,
    };
  })();

  const convoy = (function probeConvoy() {
    // Task 11's end state, read at the beat it is staged for. The batch is static
    // world geometry (R19), so there is no frame delta to measure: the proof has to
    // be the responders' own paint. The two lightbar hexes are the only saturated
    // red and the only saturated blue in the dusk palette, so a pixel that reads
    // that way is a lightbar the lens actually sees.
    //
    // The four fixed framings orbit the *tower*, so the wall of cruisers - which
    // stands in the forecourt, along the north face of the podium - is hidden behind
    // the massing in three of them. What Task 12 will do for these beats is a
    // pull-back along the route, and that is what this probe does today: a legal
    // witness lens (envelope-checked, R12/R13) out on the plaza side, looking down
    // the row. If the wall reaches pixels from here, the batch is in the cloud.
    N.clock.seekTo("fedConvoy");
    N.clock.tick(10);                                   // inside the fedConvoy beat
    const stage = N.convoy.stage;
    const at = (f) => N.convoy.routeAt(f);
    const poses = [];
    const shot = (name, pos, target, fov) => {
      N.scene.setPose({ pos, target, fov });
      const fr = N.scene.step(0);
      const px = look(240, 135);
      const cam = N.scene.camera.position;
      poses.push({
        name, t: fr.t, beat: fr.beat && fr.beat.id,
        outside: N.envelope.isOutside({ x: cam.x, y: cam.y, z: cam.z }),
        red: px.red, blue: px.blue, lights: px.red + px.blue, fx: N.scene.stats.fx,
      });
    };
    // The boulevard approach, straight out from the wall's west end, and the pull
    // back the route's own far end gives: a lens high on the plaza, looking down the
    // two rows from beyond the pool.
    shot("wall from the plaza", { x: -14, y: 12, z: 46 }, { x: 0, y: 2, z: 21 }, 45);
    shot("wall from the route's end", { x: at(1).x - 6, y: 18, z: stage.z1 + 12 },
      { x: 0, y: 1, z: (stage.z0 + stage.z1) / 2 }, 50);
    return {
      poses,
      lights: poses.reduce((s, p) => s + p.lights, 0),
      cells: N.convoyWorld().lightBarCount,
      cars: N.convoyWorld().carCount,
      window: N.convoy.window,
    };
  })();

  const rig = (function probeRig() {
    // Task 12's end state: the take itself, driven through the real loop path -
    // unpaused, step(dt) ticks the clock and the rig together. The witness
    // invariants (R12/R13) are asserted against the camera the page actually
    // renders with: every frame outside the envelope, fov inside the clamp,
    // no cut (steps are dollies), every beat seen and on screen.
    if (!N.rig) return { missing: true };
    // The framing probes above left the mouse-style lens claimed; this probe is the
    // take, so it has to hand the lens back first. R is also the way the tool says
    // "the take painted this", rather than the probe calling the handler itself.
    N.scene.restart();                        // the take has the lens
    N.scene.togglePause();                    // the loop owns the clock now
    N.clock.seekTo(N.clock.order[0]);
    const dt = N.clock.dtClamp;
    const lensCell = (v) => ({
      x: Math.floor(v.x + 1e-9), y: Math.floor(v.y + 1e-9), z: Math.floor(v.z + 1e-9),
    });
    const seen = {}, firstFrame = {}, fovBad = [], inside = [];
    let prev = null, maxStep = [0, 0], frames = 0, wraps = 0, guard = 0;
    while (guard++ < 60000 && wraps === 0) {
      const fr = N.scene.step(dt);            // tick, rig pose, paint, HUD
      const cam = N.scene.camera.position;
      const fov = N.scene.camera.fov;
      const c = lensCell(cam);
      if (N.envelope.isOutside(c) !== true) inside.push({ t: fr.t, cell: c });
      if (!(fov >= 35 && fov <= 60)) fovBad.push({ t: fr.t, fov });
      if (prev) {
        const d = Math.hypot(cam.x - prev.x, cam.y - prev.y, cam.z - prev.z);
        if (d > maxStep[0]) maxStep = [Number(d.toFixed(2)), fr.t];
      }
      prev = { x: cam.x, y: cam.y, z: cam.z };
      frames++;
      if (fr.beat && !seen[fr.beat.id]) {
        seen[fr.beat.id] = true;
        // The beat's first painted frame: the lens pose the take carried into
        // the beat is what has to put the next action on screen.
        const px = look(48, 27);
        firstFrame[fr.beat.id] = {
          t: fr.t, source: N.scene.cameraSource,
          towerFrac: px.towerFrac, lights: px.red + px.blue,
        };
      }
      if (fr.wrapped) wraps = 1;
    }
    N.scene.togglePause();                    // hand the clock back to the tool
    return {
      frames,
      wraps,
      inside,
      fovBad,
      maxStep,
      firstFrame,
      // The queue walked the same take: step()'s pump counted every entry that
      // crossed a frame boundary (the context is silent here - no gesture in the
      // tool's page - but crossings are data, and the count is proof the page-side
      // queue ran through the whole show).
      audio: { queued: N.audio.queue.length, fired: N.audio.fired },
      missingBeats: N.clock.order.filter((id) => !seen[id]),
    };
  })();

  // The fade has to track clock.fade.black, in both directions, on the element that
  // actually does the fading. Both the inline value the page wrote (exact) and the
  // value the browser computes for it (what the compositor uses) are reported.
  N.clock.seekTo("drestle");
  let guard = 0;
  while (N.clock.t < N.clock.FADE_START + 2 && guard++ < 400) N.clock.tick(N.clock.dtClamp);
  N.scene.step(0);
  const fadeEl = document.getElementById("fade");
  const fadeMid = {
    inline: fadeEl.style.opacity,
    computed: Number(getComputedStyle(fadeEl).opacity),
    black: N.clock.fade.black,
    label: document.getElementById("beat").textContent,
  };
  while (N.clock.fade.black < 1 && guard++ < 400) N.clock.tick(N.clock.dtClamp);
  N.scene.step(0);
  const fadeBlack = {
    inline: fadeEl.style.opacity,
    computed: Number(getComputedStyle(fadeEl).opacity),
    black: N.clock.fade.black,
  };

  return JSON.stringify({
    canvases: document.querySelectorAll("canvas").length,
    canvas: { w: canvas.width, h: canvas.height },
    stats: N.scene.stats,
    bufferVoxels: N.vox.count,
    splatPoints: N.splats(N.vox.buffer()).points.length,
    holdLabel: N.clock.HOLD_LABEL,
    clockOrder: N.clock.order.length,
    fx,
    convoy,
    rig,
    views,
    fadeMid,
    fadeBlack,
    paused: N.scene.paused,
    running: N.scene.running,
  });
})()`);

console.log(report);
console.log(JSON.stringify(sceneReport, null, 2));

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
check(!report.fatal, report.fatal || "boot");
check(report.seeked.id === 360, `seekTo("blast") is 360, got ${report.seeked.id}`);
check(report.seeked.label === "blast", `the blast beat is current at its start, got ${report.seeked.label}`);
check(report.blackAt !== null && report.blackAt < report.showLen,
  `fade reaches full black (${report.blackAt}) before the cut at ${report.showLen}`);
check(report.wraps === 1, `the loop wraps exactly once, got ${report.wraps}`);
check(report.wrappedAt !== null && report.wrappedAt > report.showLen,
  `the wrap waits for the grace frame past ${report.showLen}, got ${report.wrappedAt}`);
check(report.afterWrap === report.dtClamp || report.afterWrap === 0,
  `the clock restarts from 0 after the wrap, got ${report.afterWrap}`);
check(report.holdLabel === null, `no beat label through the hold, got ${JSON.stringify(report.holdLabel)}`);

check(!sceneReport.fatal, `${sceneReport.fatal || "boot"} (scene payload)`);
if (!sceneReport.fatal) {
  check(sceneReport.canvases === 1, `the stage holds exactly one canvas, got ${sceneReport.canvases}`);
  check(sceneReport.canvas.w >= 200 && sceneReport.canvas.h >= 200,
    `the renderer sized the canvas, got ${JSON.stringify(sceneReport.canvas)}`);
  check(sceneReport.stats.points === sceneReport.bufferVoxels && sceneReport.stats.points === sceneReport.splatPoints,
    `splat points ${sceneReport.stats.points} equal the buffer voxels ${sceneReport.bufferVoxels} and the splats ${sceneReport.splatPoints}`);
  check(sceneReport.stats.voxels === sceneReport.bufferVoxels,
    `stats.voxels ${sceneReport.stats.voxels} equals the buffer's ${sceneReport.bufferVoxels}`);
  check(sceneReport.running && sceneReport.paused,
    `the loop is running and paused for the drive, got running=${sceneReport.running} paused=${sceneReport.paused}`);
  for (const v of sceneReport.views) {
    check(v.t === 390, `framing ${v.framing} painted the storm beat at t=390, got t=${v.t}`);
    check(v.label === v.clockLabel,
      `framing ${v.framing} HUD label follows the beat, got ${JSON.stringify(v.label)} vs ${JSON.stringify(v.clockLabel)}`);
    check(v.fade === 0, `framing ${v.framing} shows no fade at t=390, got ${v.fade}`);
    check(v.pixels.towerFrac >= MIN_TOWER_FRAC,
      `framing ${v.framing} puts the tower on screen: ${(v.pixels.towerFrac * 100).toFixed(1)}% of the frame `
      + `off the background (${v.pixels.tower}/${v.pixels.total} scan points)`);
    check(v.outside, `framing ${v.framing} keeps the lens outside the tower envelope`);
  }
  // The wide shot is the one frame the whole show establishes: the tower plus the
  // plaza has to read in it, so it gets a higher bar than the close-ups.
  check(sceneReport.views[0].pixels.towerFrac >= MIN_TOWER_WIDE,
    `framing 1 (boulevard wide) frames the whole show: ${(sceneReport.views[0].pixels.towerFrac * 100).toFixed(1)}% of the frame is content`);
  // The same shot has to hold the massing, not clip it: content that reaches the
  // top row means the roofline is off screen. The bottom is allowed to clip, because
  // the ground plane runs on to the lens in any wide shot above street level.
  check(sceneReport.views[0].pixels.boxTop >= BOX_TOP_MARGIN,
    `framing 1 shows the tower's roof: content starts at scan row ${sceneReport.views[0].pixels.boxTop}, `
    + `needs ${BOX_TOP_MARGIN} rows of sky above it`);
  check(sceneReport.views[0].pixels.boxH >= MIN_BOX_H,
    `framing 1 spans the massing: content box is only ${(sceneReport.views[0].pixels.boxH * 100).toFixed(1)}% of the frame height`);
  check(sceneReport.views.some((v) => v.pixels.warm > 0),
    `the warm lobby glow reaches the screen: ${sceneReport.views.map((v) => v.pixels.warm).join("/")}`);
  check(Number(sceneReport.fadeMid.computed) > 0 && Number(sceneReport.fadeMid.computed) < 1,
    `the fade element is mid-fade, not blanked or black: ${JSON.stringify(sceneReport.fadeMid)}`);
  check(Math.abs(Number(sceneReport.fadeMid.inline) - sceneReport.fadeMid.black) < 1e-9
    && Math.abs(Number(sceneReport.fadeMid.computed) - sceneReport.fadeMid.black) < 1e-3,
    `the fade element tracks clock.fade.black mid-fade, got ${JSON.stringify(sceneReport.fadeMid)}`);
  check(Number(sceneReport.fadeBlack.inline) === 1 && Number(sceneReport.fadeBlack.computed) === 1
    && sceneReport.fadeBlack.black === 1,
    `the fade element reaches full black, got ${JSON.stringify(sceneReport.fadeBlack)}`);
  check(sceneReport.fadeMid.label === sceneReport.holdLabel,
    `the HUD shows the hold label through the hold, got ${JSON.stringify(sceneReport.fadeMid.label)}`);

  // --- the blast/storm overlay, asserted end-to-end -------------------------
  // The overlay is a function of t, so the proof has two halves: the data never
  // paints outside its window, and inside the window the shards and the flash
  // actually change pixels. Same framing, same lens for every pair, so a cool
  // pixel can only come from the overlay.
  for (const s of [sceneReport.fx.quiet, sceneReport.fx.endQ])
    check(s.cells === 0 && s.drawn === 0,
      `the overlay paints at t=${s.t}, outside its window (${s.cells} cells, ${s.drawn} drawn)`);
  for (const s of [sceneReport.fx.mid, sceneReport.fx.flash]) {
    check(s.cells > 0 && s.drawn === s.cells,
      `t=${s.t}: the overlay drew ${s.drawn} of ${s.cells} cells`);
  }
  check(sceneReport.fx.delta >= MIN_OVERLAY_PIXELS,
    `the shard burst reaches the screen at mid-storm: ${sceneReport.fx.delta} cool pixels over the quiet frame `
    + `(quiet ${sceneReport.fx.quiet.cool}, mid ${sceneReport.fx.mid.cool})`);
  check(sceneReport.fx.flashDelta >= MIN_OVERLAY_PIXELS,
    `the blast flash reaches the screen: ${sceneReport.fx.flashDelta} cool pixels over the quiet frame `
    + `(quiet ${sceneReport.fx.quiet.cool}, flash ${sceneReport.fx.flash.cool})`);

  // --- the convoy, asserted end-to-end --------------------------------------
  // Ruling R19 makes the batch static world geometry, so the screen proof cannot be
  // a frame delta: it is the responders' own colours landing on the sensor. The
  // lightbars are the only saturated red and saturated blue in the dusk palette, and
  // the lens that sees them is a legal one - outside the envelope, the same rule the
  // show's own camera obeys.
  for (const p of sceneReport.convoy.poses) {
    check(p.outside === true, `the ${p.name} lens is inside the tower envelope`);
    check(p.beat === "fedConvoy" || p.beat === "wallOfCars",
      `the ${p.name} witness is not on a fed beat, got ${JSON.stringify(p.beat)}`);
    check(p.fx === 0, `the ${p.name} frame has the fx overlay drawing ${p.fx} cells during the fed beats`);
  }
  check(sceneReport.convoy.lights >= MIN_LIGHT_PIXELS,
    `the convoy's lightbars reach the screen: ${sceneReport.convoy.lights} responder-light pixels `
    + `across ${sceneReport.convoy.poses.map((p) => `${p.name} ${p.red}/${p.blue}`).join(", ")} `
    + `(${sceneReport.convoy.cells} light cells staged on ${sceneReport.convoy.cars} vehicles)`);

  // --- the take, asserted end-to-end ----------------------------------------
  // Task 12's contract is a witness, not a framing: the page's own camera, driven
  // by the rig through the same step() the rAF loop uses, covers every beat of the
  // score from outside the envelope, with no cuts and no zoom lens. Everything here
  // is the camera the page actually rendered with - not rig.sample() read directly.
  check(!sceneReport.rig.missing, "the camera rig is not wired into the render loop");
  if (!sceneReport.rig.missing) {
    const t = sceneReport.rig;
    check(t.wraps === 1, `the take runs to the wrap and hands the loop back, wrapped=${t.wraps}`);
    check(t.inside.length === 0,
      `every frame of the take keeps the lens outside the envelope: ${t.inside.length} inside frames `
      + `${JSON.stringify(t.inside.slice(0, 5))}`);
    check(t.fovBad.length === 0,
      `every frame of the take is inside the fov clamp 35..60: ${t.fovBad.length} bad frames `
      + `${JSON.stringify(t.fovBad.slice(0, 5))}`);
    check(t.maxStep[0] <= MAX_RIG_STEP_CELLS,
      `the take never cuts: largest frame-to-frame move is ${t.maxStep[0]} cells at t=${t.maxStep[1]} `
      + `(needs <= ${MAX_RIG_STEP_CELLS})`);
    check(t.missingBeats.length === 0,
      `the take witnesses every beat: no painted frame for ${JSON.stringify(t.missingBeats)}`);
    check(Object.keys(t.firstFrame).length === sceneReport.clockOrder,
      `the take paints a first frame for every beat, got ${Object.keys(t.firstFrame).length} `
      + `of ${sceneReport.clockOrder}`);
    for (const [id, f] of Object.entries(t.firstFrame))
      check(f.towerFrac >= MIN_RIG_TOWER_FRAC,
        `beat ${id} has the tower in its first frame (${(f.towerFrac * 100).toFixed(1)}% of the frame)`);
    // The framing proof: those first frames came from the take, not from a pinned
    // lens. The HUD knows which camera painted the frame it describes, and the
    // review screenshots beside the bars read that label.
    const notTake = Object.entries(t.firstFrame).filter(([, f]) => f.source !== "take");
    check(notTake.length === 0,
      `the take's own lens paints every beat's first frame, not ${JSON.stringify(notTake.slice(0, 4))}`);
    // The queue's part of the take: step()'s pump has to have walked the whole
    // queue in one full run. Page-side audio that only ever got read from the
    // Node side is the failure this bar exists to catch.
    check(t.audio.queued > 0 && t.audio.fired === t.audio.queued,
      `the page-side queue walked the whole show in one take: fired=${t.audio.fired} of ${t.audio.queued}`);
  }
}

// --- screenshots for review: two framings and the convoy witness, all mid-show,
// no fade overlay.
const shots = [];
const shoot = (label, setup) => {
  const painted = evalJs(`(() => {
    const N = window.NAKATOMIC;
    ${setup}
    const fr = N.scene.step(0);
    return JSON.stringify({ t: fr.t, beat: fr.beat && fr.beat.id, label: ${JSON.stringify(label)},
      camera: N.scene.cameraSource,
      meta: document.getElementById("meta").textContent,
      fade: getComputedStyle(document.getElementById("fade")).opacity });
  })()`);
  const png = join(dir, "ui-verify", `${label}.png`);
  mkdirSync(dirname(png), { recursive: true });
  run(`agent-browser screenshot ${JSON.stringify(png)}`);
  const size = existsSync(png) ? statSync(png).size : 0;
  shots.push({ ...painted, png, size });
  check(size > 20000, `screenshot ${label} is a real frame (${size} bytes)`);
};
for (const [framing, beat, name] of FRAMINGS_SHOTS)
  shoot(name, `N.clock.seekTo(${JSON.stringify(beat)}); N.scene.setFraming(${framing});`);
for (const [beat, name, pos, target, fov] of POSE_SHOTS)
  shoot(name, `N.clock.seekTo(${JSON.stringify(beat)}); `
    + `N.scene.setPose(${JSON.stringify({ pos, target, fov })});`);
// The take's own lens at a beat's own time: hand the clock to the loop, run the
// show to the beat's fraction, hand it back, and paint the pose the rig left on
// the camera. No setFraming, no setPose - this is the show's framing, not the tool's.
// The restart hands the lens back to the take: the framing and pose shots above
// claimed it, and a shot whose lens was claimed by a key is not the take's frame.
for (const [beat, frac, name] of RIG_SHOTS)
  shoot(name, `N.scene.restart(); N.clock.seekTo(${JSON.stringify(beat)}); `
    + `N.scene.togglePause(); `
    + `const tgt = N.clock.start(${JSON.stringify(beat)}) + ${frac} * N.clock.dur(${JSON.stringify(beat)}); `
    + `let g = 0; while (N.clock.t < tgt && g++ < 4000) N.scene.step(N.clock.dtClamp); `
    + `N.scene.togglePause();`);
console.log(shots.map((s) => `shot ${s.png} t=${s.t} beat=${s.beat}`).join("\n"));
if (sceneReport.rig) {
  const take = Object.entries(sceneReport.rig.firstFrame)
    .map(([id, f]) => `${id} t=${f.t.toFixed(1)} tower ${(f.towerFrac * 100).toFixed(1)}% lights ${f.lights}`).join("\n");
  console.log(`\ntake: ${sceneReport.rig.frames} frames to the wrap, biggest step `
    + `${sceneReport.rig.maxStep[0]} cells at t=${sceneReport.rig.maxStep[1]}; `
    + `inside frames ${sceneReport.rig.inside.length}, fov bad ${sceneReport.rig.fovBad.length}, `
    + `queue crossings ${sceneReport.rig.audio.fired}/${sceneReport.rig.audio.queued}\n${take}`);
}

if (fails.length) {
  console.error("FAIL:\n - " + fails.join("\n - "));
  process.exit(1);
}
const px = sceneReport.views.map((v) => `${v.framing}:${v.pixels.tower}/${v.pixels.total}`).join(" ");
console.log(`ui-verify: show ran ${report.frames} clamped frames to the wrap; `
  + `${sceneReport.stats.points} splats on screen (centre hits ${px}); `
  + `the take witnessed ${Object.keys(sceneReport.rig.firstFrame).length}/${sceneReport.clockOrder} beats `
  + `with ${sceneReport.rig.frames} frames, biggest dolly step ${sceneReport.rig.maxStep[0]} cells; end state good`);
