// Diagnostic report with a built-in budget gate: prints the layout's shape and
// reconciles it against the 3,647-contact package count. It exits nonzero if
// the count drifts or the row table disagrees with the pad list, so re-tuning
// the cutout rectangles in the page cannot quietly change the number this whole
// showcase is named after.
// Usage: node verify/layout-report.mjs
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";

const BUDGET = 3647;

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const src = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];

const noop = () => {};
const sandbox = {
  console, performance: { now: () => 0 }, requestAnimationFrame: noop, cancelAnimationFrame: noop,
  // getContext -> null makes boot() take the documented failure path, which is
  // all we need: the pure layout functions are published before boot ever runs.
  document: {
    getElementById: () => ({
      getContext: () => null, classList: { add: noop, remove: noop }, width: 0, height: 0,
      addEventListener: noop, textContent: "",
    }),
  },
  addEventListener: noop,
};
sandbox.window = sandbox;
runInNewContext(src, createContext(sandbox), { filename: "index.html" });

const layout = sandbox.window.__api.composeLayout();
const { grid, rows } = layout;

// Every grid position: rows -cols..cols times rows -rows..rows. Counting the
// grid as a rectangle (not (2cols+1) arithmetic) keeps the cutout deltas honest.
const fullGrid = (2 * grid.cols + 1) * (2 * grid.rows + 1);
const rowTableTotal = rows.reduce((n, r) => n + r.count, 0);
const survivingInCutout = (c) =>
  layout.pads.filter((p) => p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1).length;

console.log("instanceCount:", layout.instanceCount);
console.log("cols:", grid.cols, "rows(+1):", rows.length);
console.log(`full grid ${fullGrid} minus cutouts ${(fullGrid - layout.instanceCount)} = ${layout.instanceCount}`);
for (const c of layout.cutouts) {
  // Surviving pads are by definition never inside their own cutouts: a nonzero
  // here is a punch predicate bug, not a tuning choice.
  const leak = survivingInCutout(c);
  console.log(`  ${c.name}: ${leak === 0 ? "clean" : `LEAK ${leak} surviving pads inside the rect`}`);
}

const hist = new Map();
for (const r of rows) hist.set(`${r.count} pads / ${r.spans.length} spans`, (hist.get(`${r.count} pads / ${r.spans.length} spans`) || 0) + 1);
console.log("row histogram:", [...hist.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k} x${v}`).join(", "));

// The gate: exit nonzero when any reconciliation drifts.
const problems = [];
if (layout.instanceCount !== BUDGET) problems.push(`instanceCount ${layout.instanceCount}, want the ${BUDGET}-contact budget`);
if (rowTableTotal !== layout.instanceCount) problems.push(`row table sums ${rowTableTotal}, pad list ${layout.instanceCount}`);
for (const c of layout.cutouts) {
  const leak = survivingInCutout(c);
  if (leak !== 0) problems.push(`${c.name}: ${leak} surviving pads inside the rect`);
}
if (problems.length) {
  for (const p of problems) console.error("FAIL:", p);
  process.exit(1);
}
console.log(`layout reconciles: ${layout.instanceCount} pads == ${BUDGET} budget`);
