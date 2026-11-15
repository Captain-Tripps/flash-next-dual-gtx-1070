// Framing probe: aim the camera at an arbitrary point through window.AER.cam,
// then take the frame and report the census. Useful for putting a specific
// perch, the derrick or the boathouse in frame to check it reads at that level.
//
// Needs the `agent-browser` CLI on PATH.
//
// Usage:
//   node tools/aim-shot.mjs <index.html> <label> <yaw> <pitch> <range> <x> <y> <z>
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const a = process.argv.slice(2);
const file = a[0], label = a[1];
if (!file || a.length < 8) {
  console.error("usage: node tools/aim-shot.mjs <index.html> <label> yaw pitch range x y z");
  process.exit(2);
}
const url = pathToFileURL(resolve(file)).href;

const run = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const ev = (js) => JSON.parse(run(`agent-browser eval ${JSON.stringify(js)}`));

const aim =
  `(() => { AER.cam(${a[2]}, ${a[3]}, ${a[4]}, [${a[5]}, ${a[6]}, ${a[7]}]); ` +
  `return JSON.stringify({ data: AER.data(), beasts: AER.beasts() }); })()`;

run(`agent-browser open ${JSON.stringify(url)}`);
run("agent-browser wait 2200");
const view = JSON.parse(ev(aim));
run("agent-browser wait 900");
const shot = run("agent-browser screenshot").match(/saved to (.+)$/m)[1].trim();
console.log(JSON.stringify({ label, view, shot }));
