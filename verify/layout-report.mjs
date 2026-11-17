// Diagnostic report, not a test: prints the layout's count and row shape so the
// cutout areas can be re-tuned against the 3,647-contact budget by hand.
// Usage: node verify/layout-report.mjs
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";

import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";

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
console.log("instanceCount:", layout.instanceCount);
console.log("cols:", layout.grid.cols, "rows(+1):", layout.rows.length);
console.log("full grid minus cutouts:", (2 * layout.grid.cols + 1) * layout.rows.length);

for (const c of layout.cutouts) {
  const inside = layout.pads.filter((p) => p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1);
  console.log(`  ${c.name}: ${inside.length} pads punched`);
}

const wide = layout.rows.map((r) => ({ z: r.z, n: r.count, spans: r.spans.length }));
const hist = new Map();
for (const r of wide) hist.set(`${r.n} pads / ${r.spans} spans`, (hist.get(`${r.n} pads / ${r.spans} spans`) || 0) + 1);
console.log("row histogram:", [...hist.entries()].sort().map(([k, v]) => `${k} x${v}`).join(", "));
