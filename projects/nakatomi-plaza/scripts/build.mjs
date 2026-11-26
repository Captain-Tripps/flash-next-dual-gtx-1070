// Joins the authored fragments in src/ into the single index.html the scene runs
// on. index.html is a build artifact: never hand-edit it.
//
// Fragment 01 opens the HTML document and the module script tag; the fragments
// after it are consecutive bodies of that one script, so the numeric prefixes
// are the join order and a fragment may only use APIs defined earlier. The
// closing tags are appended here, not in the last fragment.
//
// Usage: node scripts/build.mjs [--check]
//   --check  extract the module body and run node --check on it (syntax gate)

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src");
const OUT = resolve(ROOT, "index.html");
const SCRATCH = resolve(ROOT, ".superpowers", "sdd", "build-check");

const CLOSER = "\n</script>\n</body>\n</html>\n";

function fragments() {
  return readdirSync(SRC)
    .filter((f) => /^\d{2}-.*\.txt$/.test(f))
    .sort()
    .map((f) => ({ name: f, body: readFileSync(resolve(SRC, f), "utf8") }));
}

function join() {
  const fs = fragments();
  if (!fs.length) throw new Error(`no numbered fragments in ${SRC}`);
  if (!/<script type="module">/.test(fs[0].body))
    throw new Error(`${fs[0].name} must open the document and the module script tag`);
  return fs.map((f) => f.body.replace(/\r\n/g, "\n")).join("\n") + CLOSER;
}

function moduleBody(html) {
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no module body in the built page");
  return m[1];
}

const files = fragments();
const html = join();
writeFileSync(OUT, html.replace(/\r\n/g, "\n"), "utf8");
console.log(`built index.html from ${files.length} fragments: ${files.map((f) => f.name).join(", ")}`);

if (process.argv.includes("--check")) {
  mkdirSync(SCRATCH, { recursive: true });
  const probe = resolve(SCRATCH, "module-body.mjs");
  const body = moduleBody(html).replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["'];?/m,
    (_all, ns) => `const ${ns} = globalThis.__THREE_STUB__ ?? {};`
  );
  writeFileSync(probe, body, "utf8");
  try {
    execFileSync(process.execPath, ["--check", probe], { stdio: "inherit" });
    console.log("check: module body parses");
  } catch {
    rmSync(SCRATCH, { recursive: true, force: true });
    process.exit(1);
  }
}
