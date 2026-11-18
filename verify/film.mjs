// Cinema reel capture driver for index.html.
//
// Frame-stepping, not realtime MediaRecorder: each frame of the reel is
// rendered deterministically by the page's renderCinemaFrame(ms) and then
// screenshotled over CDP, so what the encoder muxes is exactly what the
// keyframe table says, encode-after-encode. No npm dependencies either:
// Node 24 already speaks WebSocket and Chrome already speaks CDP.
//
// Usage:
//   node verify/film.mjs          capture 2400 frames + mux + gate
//   node verify/film.mjs --gate   gate the already-encoded MP4 only
//
// The plan's beat sheet numbers contain an arithmetic slip: 1200 frames at
// 60 fps is 20 s, not the 40 s reel - and its own boundary frame (39983.33 ms)
// is frame 2399 at 60 fps. The internally consistent reading, and the one the
// unit tests pin, is 2400 frames. This driver follows that.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PAGE_URL = "file:///" + join(ROOT, "index.html").replaceAll("\\", "/") + "?cinema=1";
const FRAMES_DIR = join(ROOT, ".superpowers", "film");
const MP4_PATH = join(ROOT, "reel", "lga3647-reel.mp4");

export const FPS = 60;
// 40.000 s at 60 fps; last frame ms = 39983.33. The FILM_FRAMES override is a
// smoke-test dial (the full 2400-frame run stays the default).
export const FRAMES = Number(process.env.FILM_FRAMES || 2400);
const CDP_PORT = 9334; // private port: the agent-browser default session lives elsewhere

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every driver failure is named: a stack trace is not an actionable message. */
class FilmError extends Error {}
const fail = (message) => {
  throw new FilmError(message);
};

/* ---------------------------------------------------------------- tools */

/**
 * Resolve a tool without hard-coding a machine: env override first, then the
 * known install trees. Returns the exe path; the failure path names what is
 * missing and how to point at it. A hard crash on a missing tool gets a
 * driver rewritten on every new laptop; a named error does not.
 */
function findTool(envVar, candidateFn, what) {
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    if (!existsSync(fromEnv)) fail(`${envVar} points at ${fromEnv}, which does not exist`);
    return fromEnv;
  }
  for (const candidate of candidateFn()) {
    if (existsSync(candidate)) return candidate;
  }
  fail(`${what} not found. Install it, or set ${envVar} to its full path.`);
}

function ffmpegExeCandidates() {
  const pkgRoot = join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  if (!existsSync(pkgRoot)) return [];
  const found = [];
  for (const pkg of readdirSync(pkgRoot)) {
    if (!/^Gyan\.FFmpeg/i.test(pkg)) continue;
    const pkgDir = join(pkgRoot, pkg);
    for (const versionDir of readdirSync(pkgDir)) {
      found.push(join(pkgDir, versionDir, "bin", "ffmpeg.exe"));
    }
  }
  return found;
}

function ffprobeExeCandidates() {
  const pkgRoot = join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  if (!existsSync(pkgRoot)) return [];
  const found = [];
  for (const pkg of readdirSync(pkgRoot)) {
    if (!/^Gyan\.FFmpeg/i.test(pkg)) continue;
    const pkgDir = join(pkgRoot, pkg);
    for (const versionDir of readdirSync(pkgDir)) {
      found.push(join(pkgDir, versionDir, "bin", "ffprobe.exe"));
    }
  }
  return found;
}

function chromeExeCandidates() {
  const programFiles = [
    process.env.ProgramFiles || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
  ];
  const local = process.env.LOCALAPPDATA || "";
  return [
    ...programFiles.map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe")),
    join(local, "Google", "Chrome", "Application", "chrome.exe"),
  ];
}

const findFfmpeg = () => findTool("FFMPEG_PATH", ffmpegExeCandidates, "ffmpeg (the muxer)");
const findFfprobe = () => findTool("FFPROBE_PATH", ffprobeExeCandidates, "ffprobe (the gate)");
const findChrome = () => findTool("CHROME_PATH", chromeExeCandidates, "Google Chrome (the renderer)");

/* --------------------------------------------------------------- spawn */

function runTool(exe, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${exe} exited ${code}:\n${err.slice(-500)}`))));
  });
}

/** Binary stdout only (rawvideo decode): the chunks collected whole. */
function runBinary(exe, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let err = "";
    child.stdout.on("data", (d) => { chunks.push(d); });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${exe} exited ${code}:\n${err.slice(-500)}`))));
  });
}

/* ------------------------------------------------------------- capture */

/**
 * One CDP pipe over the browser-level websocket. Commands are keyed by id;
 * events arrive too and are ignored on purpose: the driver never needs a
 * lifecycle event, it asks the page for state instead.
 */
class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id) return;
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`CDP ${msg.method}: ${msg.error.message}`));
      else waiter.resolve(msg.result);
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new CdpConnection(ws)));
      ws.addEventListener("error", () => reject(new Error(`CDP websocket connect failed: ${url}`)));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = this.sessionId ? { id, method, params, sessionId: this.sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    this.ws.close();
  }
}

/** Runtime.evaluate with the page's own exceptions surfaced, not swallowed. */
async function evaluate(conn, expression) {
  const res = await conn.send("Runtime.evaluate", { expression, returnByValue: true });
  if (res.exceptionDetails) {
    fail(`page threw: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
  }
  return res.result.value;
}

async function waitForCdp(port, attempts = 40) {
  const url = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Port refused is Chrome still coming up, the normal state for the
      // first few hundred ms - not an error worth printing about.
    }
    await sleep(500);
  }
  fail(`Chrome would not offer CDP on port ${port}: did it refuse to start headless?`);
}

async function waitPageReady(conn) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await evaluate(conn, "document.readyState")) === "complete") return;
    await sleep(250);
  }
  fail("the page never reached readyState=complete under ?cinema=1");
}

async function assertReelFraming(conn) {
  const [width, height, dpr] = JSON.parse(await evaluate(conn, "JSON.stringify([innerWidth, innerHeight, devicePixelRatio])"));
  if (width !== 1920 || height !== 1080) {
    fail(`headless window is ${width}x${height}, want 1920x1080: --window-size did not take`);
  }
  if (dpr !== 1) fail(`devicePixelRatio ${dpr}, want 1: --force-device-scale-factor did not take`);
}

async function captureFrames() {
  const chromeExe = findChrome();
  mkdirSync(FRAMES_DIR, { recursive: true });
  mkdirSync(join(ROOT, "reel"), { recursive: true });

  // The private user-data-dir is what keeps this Chrome ours alone: a shared
  // profile would sync into the user's real browser and open its tabs.
  const flags = [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--window-size=1920,1080",
    "--force-device-scale-factor=1",
    "--allow-file-access-from-files",
    `--user-data-dir=${join(FRAMES_DIR, "chrome-profile")}`,
    "--enable-unsafe-swiftshader", // only a fallback if ANGLE ever meets a headless GPU
    "--no-first-run",
    "--no-default-browser-check",
  ];
  const chrome = spawn(chromeExe, flags, { stdio: "ignore" });
  chrome.on("error", (err) => {
    // Late-spawn failures (exe quarantined between the find and the spawn)
    // would otherwise be an uncaughtException burying the real message.
    fail(`could not drive Chrome at ${chromeExe}: ${err.message}`);
  });
  const conn = await CdpConnection.connect((await waitForCdp(CDP_PORT)).webSocketDebuggerUrl);
  try {
    const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
    conn.sessionId = (await conn.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    await conn.send("Page.enable");
    // Force the exact reel viewport rather than trusting --window-size: in
    // headless, the window size carries chrome offsets that vary by build,
    // so innerWidth/innerHeight come back short (measured: 1904x985 on
    // Chrome 157). The emulation override pins the viewport deterministically.
    await conn.send("Emulation.setDeviceMetricsOverride", {
      width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
    });
    await conn.send("Page.navigate", { url: PAGE_URL });
    await waitPageReady(conn);
    await assertReelFraming(conn);
    if ((await evaluate(conn, "window.__api && window.__api.cinemaMode")) !== true) {
      fail("?cinema=1 did not activate cinema mode: the URL or the flag guard is off");
    }

    for (let frame = 0; frame < FRAMES; frame++) {
      const ms = (frame * 1000) / FPS;
      const st = await evaluate(conn, `window.__api.renderCinemaFrame(${ms})`);
      if (!st || !Number.isFinite(st.fadeAlpha) || !Number.isFinite(st.plateAngleDeg)) {
        fail(`frame ${frame} (t=${ms} ms) rendered a non-finite state: ${JSON.stringify(st)}`);
      }
      const shot = await conn.send("Page.captureScreenshot", { format: "jpeg", quality: 95, fromSurface: true });
      if (!shot || !shot.data) fail(`frame ${frame}: screenshot came back empty`);
      writeFileSync(join(FRAMES_DIR, `frame-${String(frame).padStart(4, "0")}.jpg`), Buffer.from(shot.data, "base64"));
      if (frame % 120 === 0) {
        console.log(`  frame ${frame}/${FRAMES} t=${ms.toFixed(1)}ms plate=${st.plateAngleDeg.toFixed(0)} fade=${st.fadeAlpha.toFixed(2)}`);
      }
    }
    // Frame-stepping means a gap in the middle would be an ffmpeg "muxes up to
    // the gap" bug, so the tail of the sequence is asserted, not trusted.
    const lastFrame = `frame-${String(FRAMES - 1).padStart(4, "0")}.jpg`;
    if (!existsSync(join(FRAMES_DIR, lastFrame))) fail(`last expected frame ${lastFrame} is absent`);
  } finally {
    conn.close();
    chrome.kill();
  }
}

/* ----------------------------------------------------------------- gate */

const expect = (condition, message) => {
  if (!condition) fail(message);
};

async function gateReel() {
  if (!existsSync(MP4_PATH)) {
    fail("reel/lga3647-reel.mp4 not found: run node verify/film.mjs (no flags) to capture it");
  }
  const ffprobe = findFfprobe();
  const { out } = await runTool(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,nb_frames:format=duration",
    "-of", "json",
    MP4_PATH,
  ]);
  const probe = JSON.parse(out);
  const stream = probe.streams?.[0];
  if (!stream) fail("ffprobe found no video stream in the reel");
  expect(stream.width === 1920 && stream.height === 1080, `reel is ${stream.width}x${stream.height}, want 1920x1080`);
  expect(stream.r_frame_rate === "60/1", `r_frame_rate ${stream.r_frame_rate}, want 60/1`);
  expect(String(stream.nb_frames) === String(FRAMES), `nb_frames ${stream.nb_frames}, want ${FRAMES}`);
  const duration = Number(probe.format?.duration);
  expect(Number.isFinite(duration) && Math.abs(duration - 40) <= 0.15, `format.duration ${duration}, want 40.0 +/- 0.15`);

  // Truth after the H.264 round trip, not truth about our own JPEGs: decode a
  // mid-reel macro-beat frame back to raw RGB and demand gold in it.
  const ffmpeg = findFfmpeg();
  const rgb = await runBinary(ffmpeg, ["-v", "error", "-ss", "22", "-i", MP4_PATH, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const wantBytes = 1920 * 1080 * 3;
  expect(rgb.length === wantBytes, `raw decode came back ${rgb.length} bytes, want ${wantBytes}`);
  let sampled = 0, gold = 0;
  for (let p = 0; p * 3 + 2 < rgb.length; p += 8) {
    sampled++;
    const i = p * 3;
    if (rgb[i] > rgb[i + 2] + 20 && rgb[i + 1] > 60) gold++; // the render-suite gold definition
  }
  const goldRatio = gold / sampled;
  expect(goldRatio >= 0.03, `gold ratio at t=22 s is ${goldRatio.toFixed(4)}, want >= 0.03: the macro beat lost its gold in the encode`);
  console.log(`  gate: 1920x1080 60/1 ${FRAMES} frames ${duration.toFixed(3)} s, gold ratio ${goldRatio.toFixed(4)}`);
}

/* ---------------------------------------------------------------- main */

export async function main(argv) {
  if (!argv.includes("--gate")) {
    const ffmpeg = findFfmpeg();
    console.log(`capturing ${FRAMES} frames at 60 fps from ${PAGE_URL}`);
    await captureFrames();
    console.log("frames done, encoding");
    const { err } = await runTool(ffmpeg, [
      "-hide_banner", "-y",
      "-framerate", String(FPS),
      "-start_number", "0",
      "-i", "frame-%04d.jpg",
      "-c:v", "libx264", "-preset", "slow", "-crf", "17",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      MP4_PATH,
    ], { cwd: FRAMES_DIR });
    console.log(err.trim().split("\n").slice(-2).join("\n"));
  }
  if (argv.includes("--no-gate")) {
    // Smoke runs: the strict duration/frame gates only mean anything for a
    // full 2400-frame capture, so a short run stops after the encode.
    console.log(`smoke run: encoded -> ${MP4_PATH} (gate skipped)`);
    return;
  }
  await gateReel();
  console.log(`film gate: pass -> ${MP4_PATH}`);
}

// Direct run only: the unit/film suites import this file without running it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`film: FAIL\n  ${err instanceof FilmError ? err.message : err.stack}`);
    process.exit(1);
  });
}
