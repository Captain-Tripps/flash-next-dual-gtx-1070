// Unit harness for index.html.
//
// The deliverable is one HTML file with one inline `<script type="module">`.
// Node can't import that, so we extract it and run it in a `vm` sandbox with a
// stub DOM. Everything the module does at boot must therefore be DOM/GL-agnostic
// enough to survive a stub — which is exactly what we want to prove.
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(HERE, "..", "index.html");

/** Extracts the single inline module out of the page. */
export function inlineModuleSource(html) {
  const match = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error("no inline module found in index.html");
  return match[1];
}

/** Minimal stub good enough to boot the page: no real DOM, no real GL. */
function makeSandbox({ glFactory = () => null } = {}) {
  const nodes = new Map();
  const makeNode = (tag) => ({
    tagName: tag,
    style: {},
    textContent: "",
    innerHTML: "",
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => null,
    clientWidth: 1280,
    clientHeight: 720,
    width: 0,
    height: 0,
    dataset: {},
  });
  const canvas = makeNode("canvas");
  canvas.getContext = (kind) => (kind === "webgl2" ? glFactory() : null);
  nodes.set("#viewport", canvas);
  nodes.set("#error-overlay", makeNode("div"));

  const document = {
    readyState: "complete",
    documentElement: makeNode("html"),
    body: makeNode("body"),
    getElementById: (id) => nodes.get("#" + id) ?? null,
    querySelector: (sel) => nodes.get(sel) ?? null,
    querySelectorAll: () => [],
    createElement: makeNode,
    addEventListener() {},
  };

  const sandbox = {
    document,
    console,
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0, // never fires: the harness must not animate
    cancelAnimationFrame() {},
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    setTimeout: () => 0,
    clearTimeout() {},
    addEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.window.document = document;
  sandbox.window.addEventListener = () => {};
  sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  return { sandbox, canvas, nodes };
}

/** Runs the page's inline module against a stub environment. */
export function boot({ glFactory } = {}) {
  const html = readFileSync(HTML_PATH, "utf8");
  const src = inlineModuleSource(html);
  const { sandbox, canvas, nodes } = makeSandbox({ glFactory });
  runInNewContext(src, createContext(sandbox), { filename: "index.html" });
  return { scene: sandbox.window.__scene, api: sandbox.window.__api, canvas, nodes, source: src, html };
}

/** A WebGL2 stub: every method is a no-op, every constant is a number. */
export function stubGL() {
  const store = new Map();
  return new Proxy(
    {
      getParameter: (p) => store.get(p) ?? 0,
      getExtension: () => null,
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getProgramInfoLog: () => "",
      getShaderInfoLog: () => "",
      canvas: null,
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== "string") return undefined;
        return (..._args) => ({});
      },
      has: () => true,
    }
  );
}

// ---------------------------------------------------------------- tests
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("page_has_no_external_module_or_fetch", () => {
  const html = readFileSync(HTML_PATH, "utf8");
  const src = inlineModuleSource(html);
  if (/^\s*import\s|^\s*export\s/m.test(src)) throw new Error("module import/export specifier found");
  if (/\bfetch\s*\(/.test(src)) throw new Error("fetch() found: page must work offline");
  if (/<script[^>]*src=/.test(html)) throw new Error("external <script src> found");
});

test("boot_withoutWebGL2_reportsOkFalse_andNamesTheWebGL2Failure", () => {
  const { scene, nodes } = boot({ glFactory: () => null });
  if (!scene) throw new Error("window.__scene was not published");
  if (scene.ok !== false) throw new Error(`expected ok:false, got ${JSON.stringify(scene.ok)}`);
  if (!String(scene.cause).includes("webgl2")) {
    throw new Error(`cause must name webgl2, got ${JSON.stringify(scene.cause)}`);
  }
  const overlay = nodes.get("#error-overlay");
  if (!overlay.textContent) throw new Error("error overlay left empty");
});

test("boot_withWebGL2_publishesDiagnosticsAndClearsFrame", () => {
  const { scene } = boot({ glFactory: () => stubGL() });
  if (!scene) throw new Error("window.__scene was not published");
  if (scene.ok !== true) throw new Error(`expected ok:true, got ${JSON.stringify(scene.cause)}`);
  for (const key of ["parts", "programs", "frames", "padCount", "plateAngleDeg", "azimuthDeg"]) {
    if (!(key in scene)) throw new Error(`__scene is missing field "${key}"`);
  }
});

const near = (actual, expected, what) => {
  const tol = 1e-6;
  const a = [...actual].map(Number);
  const b = [...expected].map(Number);
  const bad = a.findIndex((v, i) => !Number.isFinite(v) || Math.abs(v - b[i]) > tol);
  if (bad >= 0) throw new Error(`${what}: got [${a.join(", ")}], want [${b.join(", ")}]`);
};

/** The page's pure-function API (math, scene graph, layout, pose). */
const api = () => {
  const { api: a } = boot({ glFactory: () => stubGL() });
  if (!a) throw new Error("window.__api was not published: page must expose its pure functions");
  return a;
};

test("mat4_multiply_yRotation90_mapsLocalPlusXToNegZ", () => {
  const { mat4 } = api();
  const m = mat4.trs(mat4.identity(), { pos: [0, 0, 0], rot: { y: Math.PI / 2 }, scale: 1 });
  const p = mat4.transformPoint(new Float64Array(3), m, [1, 0, 0]);
  near(p, [0, 0, -1], "rotate 90 about Y of local +X");
});

test("mat4_trs_rotatesLocalPointThenTranslates", () => {
  const { mat4 } = api();
  const m = mat4.trs(mat4.identity(), { pos: [10, 0, 0], rot: { y: Math.PI / 2 }, scale: 2 });
  const p = mat4.transformPoint(new Float64Array(3), m, [0, 0, 5]);
  near(p, [20, 0, 0], "scale 2, rotate 90 about Y, then translate +10x");
});

test("node_world_parentRotated90AboutY_placesChildAtLocalPlusZ_inParentSpace", () => {
  // This is the load-plate hinge case for real: a child offset along the parent's
  // local +Z must land in the parent's rotated frame, not the world's.
  const { Node, mat4 } = api();
  const parent = new Node("hingePivot");
  parent.local = { pos: [10, 0, 0], rot: { y: Math.PI / 2 }, scale: 1 };
  const child = new Node("loadPlate");
  child.local = { pos: [0, 0, 5], scale: 1 };
  parent.add(child);
  near(mat4point(mat4, parent.world(new Float32Array(16)), [0, 0, 0]), [10, 0, 0], "parent world origin");
  near(mat4point(mat4, child.world(new Float32Array(16)), [0, 0, 0]), [15, 0, 0], "child world origin");
  if (child.parent !== parent || child.name !== "loadPlate") throw new Error("add() lost the name/parent");
});

const mat4point = (mat4, m, v) => mat4.transformPoint(new Float64Array(3), m, v);

test("mat4_perspective_aspectHalf_isFiniteAndScalesXByAspect", () => {
  const { mat4 } = api();
  const m = mat4.perspective(mat4.identity(), { fovyDeg: 45, aspect: 0.5, near: 0.1, far: 100 });
  if (!m.every((v) => Number.isFinite(v))) throw new Error("non-finite matrix entry");
  if (!(m[0] > 0 && m[5] > 0)) throw new Error(`diag signs m00=${m[0]} m11=${m[5]}`);
  if (Math.abs(m[0] * 0.5 - m[5]) > 1e-6) throw new Error(`m00*m11 ratio must carry aspect: ${m[0]} vs ${m[5]}`);
});

test("mat4_lookAt_backwardsEye_buildsNegatedZForwardBasis", () => {
  const { mat4 } = api();
  const view = mat4.lookAt(mat4.identity(), [0, 0, 5], [0, 0, 0], [0, 1, 0]);
  near([view[2], view[6], view[10]], [0, 0, 1], "view-space +Z axis (camera looks down -Z)");
  // A world point in front of the camera must land at negative view Z.
  near(mat4point(mat4, view, [0, 0, 4]), [0, 0, -1], "point ahead of camera");
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
    if (!err.message.includes("want [")) console.log(err.stack.split("\n").slice(1, 4).join("\n      "));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} unit tests passed`);
process.exit(failed ? 1 : 0);
