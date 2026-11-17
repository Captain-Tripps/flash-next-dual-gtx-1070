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

if (process.argv.includes("--shot")) {
  const out = process.argv[process.argv.indexOf("--shot") + 1] || join(HERE, "render.png");
  run(["screenshot", out]);
  console.log(`  shot  ${out}`);
}

console.log(`\n${failures.length ? failures.length + " render checks FAILED" : "render checks passed"}`);
process.exit(failures.length ? 1 : 0);
