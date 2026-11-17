// Render harness: loads index.html in a real Chrome via the agent-browser CLI,
// asserts the in-page END STATE (not DOM symptoms), and screenshots it.
//
// Usage: node verify/render.mjs [--shot out.png]
import { spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, closeSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(join(HERE, "..", "index.html"));

// The npm shim is a .cmd, and Node refuses to spawn .cmd without a shell (and a
// shell would re-quote every probe). The shim just points at a native exe, so we
// resolve that exe and spawn it directly: argv passing, no shell, no mangling.
function findAgentBrowser() {
  if (process.env.AGENT_BROWSER_BIN) return process.env.AGENT_BROWSER_BIN;
  const candidates = [
    join(process.env.USERPROFILE || "", "AppData/Roaming/npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe"),
    join(process.env.LOCALAPPDATA || "", "Microsoft/WinGet/Links/agent-browser.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return "agent-browser";
}

const AGB = findAgentBrowser();
let tmpCount = 0;

// The CLI talks to a long-lived Chrome daemon that inherits the launcher's stdio.
// Handing it a *pipe* makes spawnSync wait for EOF that never comes (the daemon is
// still alive), so the CLI calls hang forever. A real file instead of a pipe lets
// the launcher exit cleanly and we read the file back.
const run = (args) => {
  const tmp = join(tmpdir(), `agb-${process.pid}-${tmpCount++}.out`);
  const fd = openSync(tmp, "w");
  const res = spawnSync(AGB, args, { stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const out = readFileSync(tmp, "utf8");
  unlinkSync(tmp);
  if (res.status !== 0) throw new Error(`agent-browser ${args[0]} failed: ${out.trim() || res.stderr}`);
  return out.trim();
};

// agent-browser prints the eval result as a JSON string, so a returned JSON
// string needs a second parse round-trip to become an object again.
const evalJs = (js) => {
  const out = run(["eval", `(() => { ${js} })()`]);
  const value = JSON.parse(out);
  return typeof value === "string" ? JSON.parse(value) : value;
};

const url = pathToFileURL(PAGE).href;
const failures = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    console.log(`  ok  ${name}${detail ? `  ${detail}` : ""}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
};

run(["open", url]);
run(["wait", "1500"]);

check("page_reports_webgl2_ok", () => {
  const s = evalJs("return JSON.stringify(window.__scene || null);");
  if (!s) throw new Error("__scene not published");
  if (s.ok !== true) throw new Error(`ok:false cause=${s.cause}`);
  return `frames=${s.frames}`;
});

check("canvas_backing_store_is_sized", () => {
  const size = evalJs(`
    const c = document.getElementById("viewport");
    return JSON.stringify({ w: c.width, h: c.height, dpr: window.devicePixelRatio });
  `);
  if (size.w < 100 || size.h < 100) throw new Error(`canvas backing store ${size.w}x${size.h}`);
  return `${size.w}x${size.h} @${size.dpr}x`;
});

check("no_console_errors", () => {
  const errs = run(["errors"]);
  const serious = errs.split("\n").filter((l) => l && !/favicon|GPU stall|WebGL2 context/i.test(l));
  if (serious.length) throw new Error(serious.slice(0, 5).join("\n      "));
});

// --------------------------------------------- shader + pixel end-state probes
check("every_shader_program_compiles_and_links_clean", () => {
  const progs = evalJs("return JSON.stringify((window.__scene && window.__scene.programs) || {});");
  const names = Object.keys(progs);
  if (names.length < 2) throw new Error(`no programs in __scene.programs (have [${names}])`);
  for (const required of ["std", "pad"]) {
    if (!progs[required]) throw new Error(`no "${required}" program (have [${names}])`);
  }
  for (const [name, p] of Object.entries(progs)) {
    if (p.compiled === false) throw new Error(`${name} failed to compile: ${p.infoLog}`);
    if (p.linked !== true) throw new Error(`${name} failed to link: ${p.infoLog}`);
    if ((p.infoLog || "") !== "") throw new Error(`${name} reported a log: ${p.infoLog}`);
  }
  return names.join(", ");
});

const frameStats = () => evalJs("return JSON.stringify(window.__api.frameStats({ step: 3 }));");

/*
 * The hinge cycle in a real browser, driven by wall time rather than a pinned
 * pose: the unit tests can prove platePose(t) is right, but only here can we see
 * the render loop actually applying that pose to the scene graph. Sampling the
 * diagnostics across 12 s is the drive-then-assert end state - and the closed /
 * open pixel comparison proves the plate geometry moved in GL, not just in the
 * diagnostics object.
 */
check("the_plate_cycle_sweeps_past_90_degrees_and_the_open_plate_reveals_the_gold", () => {
  evalJs("window.__api.setPlateOverride(null); window.__api.orbitClock.paused = false; window.__api.orbitClock.elapsedMs = 0; return 1;");
  run(["wait", "250"]);
  const closed = evalJs("return JSON.stringify({ deg: window.__scene.plateAngleDeg, phase: window.__scene.platePhase, gold: window.__api.frameStats({ step: 3 }).goldRatio });");
  if (closed.deg > 2) throw new Error(`clock at 0 still reported the plate at ${closed.deg} deg (phase ${closed.phase})`);

  const angles = [], phases = new Set();
  let framesEnd = 0;
  for (let i = 0; i < 25; i++) {
    run(["wait", "480"]);                     // 25 x 480 ms ~ one cycle sweep
    const s = evalJs("return JSON.stringify({ deg: window.__scene.plateAngleDeg, phase: window.__scene.platePhase, frames: window.__scene.frames });");
    angles.push(s.deg);
    phases.add(s.phase);
    framesEnd = s.frames;
  }
  const open = evalJs("return JSON.stringify({ deg: window.__scene.plateAngleDeg, phase: window.__scene.platePhase, gold: window.__api.frameStats({ step: 3 }).goldRatio });");

  const maxDeg = Math.max(...angles), minDeg = Math.min(...angles);
  if (!(maxDeg >= 90)) throw new Error(`sampled angles topped out at ${maxDeg.toFixed(1)} deg, want a 90 deg crossing`);
  if (!(minDeg <= 2)) throw new Error(`sampled angles never started closed (${minDeg.toFixed(1)} deg)`);
  if (!(framesEnd > 30)) throw new Error(`only ${framesEnd} frames rendered: the rAF loop is not running`);
  if (!phases.has("open")) throw new Error(`phases seen: ${[...phases].join(", ")}`);
  if (open.phase !== "open") throw new Error(`sample window ended in phase "${open.phase}", want open for the pixel probes`);
  // Why the margin is only 1.2 points and not "obviously more": even with the
  // plate closed, the ILS window in the middle of the land grid stays uncovered,
  // so ~3 percent of the screen always reads gold. Full swing adds the rest of
  // the pad field, worth ~2 points; measured deltas run 1.7-2.0. A plate frozen
  // in place shows a delta of ~0, so 1.2 still catches the regression dead.
  if (!(open.gold > closed.gold + 0.012)) {
    throw new Error(`open plate gold ${(open.gold * 100).toFixed(2)}% vs closed ${(closed.gold * 100).toFixed(2)}%: the plate is not moving in GL`);
  }
  return `${minDeg.toFixed(0)}..${maxDeg.toFixed(0)} deg, phases ${[...phases].join("/")}, gold ${closed.gold.toFixed(3)} -> ${open.gold.toFixed(3)}`;
});

check("the_socket_covers_at_least_25_percent_of_the_view", () => {
  const s = frameStats();
  if (!(s.nonBackgroundRatio >= 0.25)) {
    throw new Error(`coverage ${(s.nonBackgroundRatio * 100).toFixed(1)}% of ${s.sampled} px (maxLuma ${s.maxLuma})`);
  }
  return `coverage ${(s.nonBackgroundRatio * 100).toFixed(1)}%`;
});

check("at_least_3_percent_of_pixels_are_gold_pads", () => {
  const s = frameStats();
  if (!(s.goldRatio >= 0.03)) {
    throw new Error(`gold ${(s.goldRatio * 100).toFixed(2)}% (samples: gold ${s.goldCount} / ${s.sampled})`);
  }
  return `gold ${(s.goldRatio * 100).toFixed(2)}% of ${s.sampled} px`;
});

// ------------------------------------- camera interaction: drive the DOM, assert the pose
// The unit tests can reach the pure camera API, but pointer and wheel handlers
// only exist in a real browser, so this is where the input path gets verified.
check("dragging_the_canvas_orbits_the_camera_by_its_published_per_pixel_rate", () => {
  const want = evalJs(`
    const api = window.__api;
    api.orbitClock.paused = true;              // freeze the spin: drag becomes the only input
    api.cameraInput.azOffsetDeg = 0;
    api.cameraInput.elevOffsetDeg = 0;
    const c = document.getElementById("viewport");
    const r = c.getBoundingClientRect();
    const x = r.left + 40, y = r.top + 40;
    const fire = (type, dx, dy) => c.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, clientX: x + dx, clientY: y + dy, bubbles: true,
    }));
    fire("pointerdown", 0, 0);
    fire("pointermove", 20, 10);               // 20 px right, 10 px down
    fire("pointerup", 20, 10);
    return JSON.stringify({
      az0: window.__scene.azimuthDeg,
      wantAz: 20 * api.ORBIT.dragDegPerPx,
      wantElev: 10 * api.ORBIT.dragDegPerPx,
    });
  `);
  run(["wait", 200]); // at least one frame for the loop to publish the pose
  const got = evalJs(`
    const api = window.__api;
    return JSON.stringify({
      azOffset: api.cameraInput.azOffsetDeg,
      elevOffset: api.cameraInput.elevOffsetDeg,
    });
  `);
  if (Math.abs(got.azOffset - want.wantAz) > 1e-6) {
    throw new Error(`20 px drag rolled azimuth by ${got.azOffset}, want ${want.wantAz}`);
  }
  if (Math.abs(got.elevOffset - want.wantElev) > 1e-6) {
    throw new Error(`10 px drag tilted elevation by ${got.elevOffset}, want ${want.wantElev}`);
  }
  evalJs("window.__api.orbitClock.paused = false; window.__api.cameraInput.azOffsetDeg = 0; window.__api.cameraInput.elevOffsetDeg = 0; return 1;");
  return `az ${want.wantAz.toFixed(2)} deg, elev ${want.wantElev.toFixed(2)} deg`;
});

check("wheeling_the_canvas_zooms_and_prevents_the_page_scrolling", () => {
  const before = evalJs("return JSON.stringify({ dist: window.__scene.cameraDist, zoomLog: window.__api.cameraInput.zoomLog });");
  const prevented = evalJs(`
    const c = document.getElementById("viewport");
    const ev = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
    c.dispatchEvent(ev);
    return JSON.stringify({ defaultPrevented: ev.defaultPrevented });
  `);
  run(["wait", 200]);
  const after = evalJs("return JSON.stringify({ dist: window.__scene.cameraDist, zoomLog: window.__api.cameraInput.zoomLog });");
  if (prevented.defaultPrevented !== true) {
    throw new Error("the wheel handler did not preventDefault: it is registered passive");
  }
  if (!(after.dist > before.dist)) throw new Error(`wheel out moved dist ${before.dist} -> ${after.dist}`);
  if (!(after.zoomLog > before.zoomLog)) throw new Error(`zoomLog ${before.zoomLog} -> ${after.zoomLog}`);
  evalJs("window.__api.cameraInput.zoomLog = 0; return 1;");
  return `dist ${before.dist.toFixed(1)} -> ${after.dist.toFixed(1)} mm`;
});

check("the_backing_store_follows_a_css_resize", () => {
  const before = evalJs("return JSON.stringify({ w: document.getElementById('viewport').width });");
  evalJs(`
    const c = document.getElementById("viewport");
    c.style.width = "640px";
    c.style.height = "400px";
    window.dispatchEvent(new Event("resize"));
    return 1;
  `);
  run(["wait", 300]); // the loop re-fits the viewport every frame
  const after = evalJs(`
    const c = document.getElementById("viewport");
    const api = window.__api;
    const dpr = Math.min(window.devicePixelRatio || 1, api.CAMERA_LIMITS.maxDpr);
    return JSON.stringify({
      w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight, dpr,
    });
  `);
  const wantW = Math.round(after.cssW * after.dpr);
  const wantH = Math.round(after.cssH * after.dpr);
  if (Math.abs(after.w - wantW) > 1 || Math.abs(after.h - wantH) > 1) {
    throw new Error(`backing store ${after.w}x${after.h}, want ${wantW}x${wantH} (css ${after.cssW}x${after.cssH} @${after.dpr}x)`);
  }
  if (after.w === before.w) throw new Error(`backing store never changed (${after.w})`);
  evalJs(`
    const c = document.getElementById("viewport");
    c.style.width = ""; c.style.height = "";
    return 1;
  `);
  return `${after.w}x${after.h} from css ${after.cssW}x${after.cssH} @${after.dpr}x`;
});

if (process.argv.includes("--shot")) {
  const out = process.argv[process.argv.indexOf("--shot") + 1] || join(HERE, "render.png");
  // Pinning the pose makes a screenshot reproducible: the cycle would otherwise
  // land anywhere between "plate closed over the gold" and mid-swing.
  evalJs("window.__api.setPlateOverride(105); return 1;");
  run(["wait", "400"]);                       // one frame for the pin to reach the scene graph
  run(["screenshot", out]);
  console.log(`  shot  ${out}`);
}

console.log(`\n${failures.length ? failures.length + " render checks FAILED" : "render checks passed"}`);
process.exit(failures.length ? 1 : 0);
