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
import { resolve } from "node:path";

const file = resolve(process.argv[2] || "index.html");
const url = pathToFileURL(file).href;
const run = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim();
// Payload goes to the CLI base64-encoded (--base64), so no shell layer can touch it:
// PowerShell 5.1 strips embedded double quotes from native-command args, and the clock
// payload is full of them. Base64 has no characters that any shell can reinterpret.
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const evalJs = (js) => decode(run(`agent-browser eval -b ${b64(js)}`));
// The CLI JSON-encodes whatever the page returned, so a JSON string returned by the page
// arrives double-encoded: one parse for the CLI wrapper, one more for the payload.
const decode = (raw) => {
  let v = JSON.parse(raw);
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { /* a plain page string stays a string */ }
  }
  return v;
};

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

  const fadeEl = document.getElementById("fade");
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
    // The fade element is only styled once the page wires the render loop (Task 13);
    // reporting it here keeps the day the wiring lands honest rather than a hole later.
    fadeOpacity: fadeEl ? getComputedStyle(fadeEl).opacity : null,
  });
})()`);

console.log(report);

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

if (fails.length) {
  console.error("FAIL:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log(`ui-verify: show ran ${report.frames} clamped frames to the wrap, end state good`);
