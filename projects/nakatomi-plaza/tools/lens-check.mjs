// Live proof for R25, in the browser the bug was reported in: the wheel and the
// free-rotate have to move the lens and keep it, the show must keep advancing under
// the takeover, and R has to hand the lens back to the take. The unit suite proves
// the wiring; this proves the picture. The reason it exists: the live tools drive the
// loop paused, so a frame that re-poses the camera from the take's keys was invisible
// to every gate, and a page whose input did nothing still tested green.
//
// Usage: node tools/lens-check.mjs
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const url = `file://${resolve(ROOT, "index.html").replaceAll("\\", "/")}`;
const run = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim();
const decode = (s) => JSON.parse(JSON.parse(s.trim()));
const evalJs = (js) => decode(run(`agent-browser eval --stdin`, { input: js }));

// What the painted camera is doing relative to the take's key for the same instant.
// distanceFromTake 0 means the loop re-posed the camera from the take's keys: the
// mouse drove nothing a person could see.
const readout = (t0) => `(() => {
  const N = window.NAKATOMIC;
  const t = N.clock.t;
  const beat = N.clock.beatAt(t);
  const key = N.rig.sample(beat ? beat.id : "open", t);
  const p = N.scene.camera.position;
  return JSON.stringify({
    t: Math.round(t * 100) / 100,
    startedAt: ${JSON.stringify(t0)},
    beat: beat && beat.id,
    label: document.getElementById("beat").textContent,
    meta: document.getElementById("meta").textContent,
    source: N.scene.cameraSource,
    follow: N.scene.follow,
    paused: N.scene.paused,
    framing: N.scene.framing,
    outside: N.envelope.isOutside({
      x: Math.floor(p.x + 1e-9), y: Math.floor(p.y + 1e-9), z: Math.floor(p.z + 1e-9),
    }),
    distanceFromTake: +Math.hypot(p.x - key.pos.x, p.y - key.pos.y, p.z - key.pos.z).toFixed(3),
  });
})()`;

const claim = `(() => {
  const N = window.NAKATOMIC;
  const c = N.scene.domElement;
  const r = c.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const f = (type, init) => c.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, clientX: cx, clientY: cy, ...init,
  }));
  const before = N.clock.t;
  f("pointerdown", {});
  // 156 px of drag is 43 degrees of orbit: gross enough that a re-pose is obvious.
  for (let i = 1; i <= 6; i++) f("pointermove", { clientX: cx + i * 26, clientY: cy + i * 10 });
  f("pointerup", {});
  c.dispatchEvent(new WheelEvent("wheel", { bubbles: true, clientX: cx, clientY: cy, deltaY: -900 }));
  return JSON.stringify({
    startedAt: before,
    hitTarget: hit === c ? "canvas" : (hit.id || hit.tagName),
    unlocked: !!(N.audio && N.audio.live),
    follow: N.scene.follow,
    source: N.scene.cameraSource,
  });
})()`;

const press = (key) => `(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)} }));
  return JSON.stringify({
    framing: window.NAKATOMIC.scene.framing,
    follow: window.NAKATOMIC.scene.follow,
    source: window.NAKATOMIC.scene.cameraSource,
  });
})()`;

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

run(`agent-browser open ${JSON.stringify(url)}`);
run(`agent-browser wait 1500`);
const boot = evalJs(`(() => JSON.stringify({ running: NAKATOMIC.scene.running,
  source: NAKATOMIC.scene.cameraSource, follow: NAKATOMIC.scene.follow }))()`);
check(boot.running === true, "the page never booted itself");
check(boot.follow === true && boot.source === "take", "the take does not own the lens at the start");

// 1. drag + wheel: the press claims the lens, the run keeps it.
const a = evalJs(claim);
check(a.hitTarget === "canvas", `the pointer landed on ${a.hitTarget}, not the canvas`);
check(a.unlocked === true, "the press did not unlock the audio queue");
check(a.follow === false, "a drag and a wheel never handed the lens to the mouse");
check(a.source === "lens", `the press left cameraSource "${a.source}", expected "lens"`);
run(`agent-browser wait 1200`);
const b = evalJs(readout(a.startedAt));
check(b.distanceFromTake > 1,
  `the frame is the take's pose again after a 43 degree drag (distance ${b.distanceFromTake})`);
check(b.t > b.startedAt, `the clock did not advance under the takeover (${b.t} after ${b.startedAt})`);
check(b.source === "lens", `the run handed the lens back to "${b.source}"`);
check(b.meta.includes("your lens"), `the meta line does not name the mouse's lens: ${JSON.stringify(b.meta)}`);
check(b.outside === true, "the mouse lens went inside the tower envelope");

// 2. R hands the lens back to the take.
evalJs(`(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" })); return "1"; })()`);
run(`agent-browser wait 400`);
const c = evalJs(readout(0));
check(c.source === "take", `R left the lens with "${c.source}"`);
check(c.follow === true, "R did not hand the lens back to the take");
check(c.distanceFromTake < 1e-6, `R restarted but the frame is ${c.distanceFromTake} cells off the take's pose`);
check(c.meta.includes(" take"), `the meta line does not name the take: ${JSON.stringify(c.meta)}`);

// 3. a 1..4 key claims the lens for good, and its framing number is on the line.
const d = evalJs(press("3"));
check(d.framing === 3 && d.follow === false && d.source === "framing",
  `the 3 key left framing=${d.framing} follow=${d.follow} source="${d.source}"`);
run(`agent-browser wait 1200`);
const e = evalJs(readout(a.startedAt));
check(e.source === "framing", `the take took the framing's lens back: "${e.source}"`);
check(e.distanceFromTake > 1, `framing 3 is holding a lens that is ${e.distanceFromTake} cells from the take`);
check(e.meta.includes("framing 3/4"), `the meta line does not show the framing number: ${JSON.stringify(e.meta)}`);

if (fails.length) {
  console.error(`lens-check FAIL:\n - ${fails.join("\n - ")}`);
  console.error(JSON.stringify({ drag: a, afterRun: b, afterR: c, key3: d, framingRun: e }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  "drag + wheel": { claimed: a.source, "lens from take": b.distanceFromTake,
    "clock advanced to": b.t, meta: b.meta },
  "R": { source: c.source, "lens from take": c.distanceFromTake, meta: c.meta },
  "key 3": { source: e.source, "lens from take": e.distanceFromTake, meta: e.meta },
}, null, 2));
console.log("lens-check: the mouse owns the lens, the show runs under it, R hands it back");
