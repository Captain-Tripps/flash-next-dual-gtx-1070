// Render gate for the aerie scene: load it, then assert the rendered END STATE
// per preset view instead of looking at a screenshot and hoping.
//
// A scene of 46k blocks can be syntactically fine and still be wrong: the first
// pass of this demo had a straight sea-tile edge visible at the field bounds, a
// perch deck that floated off the cliff, and dragons coloured close to the rock
// they stood on. None of that is a syntax error and all of it is visible if you
// sample the pixels and diff them.
//
// Needs the `agent-browser` CLI on PATH (it drives a real Chromium and reads the
// WebGL back buffer back, which the page enables with preserveDrawingBuffer).
//
// Usage:
//   node tools/render-gate.mjs <path-to-index.html> [view-count]
//
// Exit 0 when every view reported, non-zero when one of them threw.
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const file = process.argv[2];
const views = Number(process.argv[3] || 4);
if (!file) {
  console.error("usage: node tools/render-gate.mjs <index.html> [view-count]");
  process.exit(2);
}
const url = pathToFileURL(resolve(file)).href;

const run = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

// agent-browser prints an eval result as a JSON literal, and the IIFEs below
// return JSON *text*, so the value arrives double-encoded. Unwrap once, then a
// second time if it still looks like JSON.
const evalJs = (js) => {
  let out = JSON.parse(run(`agent-browser eval ${JSON.stringify(js)}`));
  if (typeof out === "string") {
    try { out = JSON.parse(out); } catch { /* plain string is fine as-is */ }
  }
  return out;
};

run(`agent-browser open ${JSON.stringify(url)}`);
run("agent-browser wait 3200");

const report = [];
for (let v = 0; v < views; v++) {
  evalJs(`(() => { AER.showView(${v}); return "view ${v + 1} settled"; })()`);
  run("agent-browser wait 2200"); // let the damped camera land on the preset
  const shot = run("agent-browser screenshot").match(/saved to (.+)$/m)[1].trim();
  report.push({ view: v + 1, shot, ...evalJs("(() => JSON.stringify(AER.probe()))()"),
    ...evalJs("(() => JSON.stringify(AER.data()))()") });
}

report.push({ consoleErrors: run("agent-browser errors").trim() || "(none)" });
for (const entry of report) console.log(JSON.stringify(entry));
