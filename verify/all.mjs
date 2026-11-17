// Runs both suites in order and reports one exit code. The harness commands in
// the plan are short enough to type, and this is the one the ledger records.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const suites = ["unit.mjs", "render.mjs"];

let failed = 0;
for (const suite of suites) {
  console.log(`\n===== verify/${suite} =====`);
  const res = spawnSync(process.execPath, [join(HERE, suite)], { stdio: "inherit" });
  if (res.status !== 0) failed++;
}
console.log(failed ? `\nALL SUITES: ${failed} suite(s) failed` : "\nALL SUITES: pass");
process.exit(failed);
