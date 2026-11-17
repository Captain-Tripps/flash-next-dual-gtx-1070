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

// ------------------------------------------------------- geometry (Task 3)
const geometryApi = () => {
  const a = api();
  for (const fn of ["buildParts", "extrudeProfile", "roundedRectProfile"]) {
    if (typeof a[fn] !== "function") throw new Error(`window.__api.${fn} is not a function`);
  }
  return a;
};

const allFinite = (arr) => arr.every((v) => Number.isFinite(v));

test("buildParts_exposesExactlyTheEightNamedSocketParts", () => {
  const a = geometryApi();
  const parts = a.buildParts();
  const want = ["substrate", "frame", "padField", "brBracket", "loadPlate", "hingeBar", "latchLever", "stiffenRing"];
  const got = Object.keys(parts).sort();
  if (got.join() !== want.slice().sort().join()) throw new Error(`got [${got}]`);
  for (const name of want) if (!(parts[name].node instanceof a.Node)) throw new Error(`${name} has no Node`);
});

test("buildParts_substrateFootprintMatchesLGA3647Envelope", () => {
  const { bbox } = geometryApi().buildParts().substrate;
  const x = bbox.max[0] - bbox.min[0];
  const z = bbox.max[2] - bbox.min[2];
  const near1 = (a, b, what) => { if (Math.abs(a - b) > b * 0.01) throw new Error(`${what}: ${a} != ${b}`); };
  near1(x, 75.9, "land-grid envelope X");
  near1(z, 61.4, "land-grid envelope Z");
});

test("buildParts_everyPart_isIndexedFiniteGeometryWithUnitNormals", () => {
  const parts = geometryApi().buildParts();
  for (const [name, part] of Object.entries(parts)) {
    const { pos, nrm, idx } = part.geometry;
    if (!idx.length) throw new Error(`${name}: empty index buffer`);
    if (pos.length % 3 !== 0) throw new Error(`${name}: pos not a vertex triple`);
    if (pos.length / 3 !== part.vertexCount) throw new Error(`${name}: vertexCount mismatch`);
    if (nrm.length !== pos.length) throw new Error(`${name}: normals missing for some vertices`);
    if (!allFinite(pos) || !allFinite(nrm) || !allFinite(idx)) throw new Error(`${name}: NaN geometry`);
    for (let i = 0; i < nrm.length; i += 3) {
      const len = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]);
      if (len < 0.99 || len > 1.01) throw new Error(`${name}: normal ${i / 3} not unit (${len})`);
    }
    if (Math.max(...idx) >= pos.length / 3) throw new Error(`${name}: index out of range`);
  }
});

test("roundedRectProfile_with4Segments_buildsFourQuarterArcsOf5PointsEach", () => {
  // segs divisions per corner -> segs+1 points per corner (both tangent points
  // included), so the flat edges stay flat instead of being chorded into a cut.
  // 6 x 1.7 with r=0.8: corner centres at (+-2.2, +-0.05), extents exactly +-3, +-0.85.
  const pts = geometryApi().roundedRectProfile(6, 1.7, 0.8, 4);
  if (pts.length !== 4 * 5 * 2) throw new Error("expected 20 points, got " + (pts.length / 2));
  const xs = pts.filter((_, i) => i % 2 === 0), zs = pts.filter((_, i) => i % 2 === 1);
  if (Math.max(...xs) !== 3 || Math.min(...xs) !== -3) throw new Error("x extent is not 6");
  if (Math.max(...zs) !== 0.85 || Math.min(...zs) !== -0.85) throw new Error("z extent is not 1.7");
  // Every point must sit on some corner arc: a chord across a fillet lands
  // inside the arc, which is exactly how a sheared outline gets born.
  const centres = [[2.2, 0.05], [-2.2, 0.05], [-2.2, -0.05], [2.2, -0.05]];
  for (let i = 0; i < pts.length; i += 2) {
    const onArc = centres.some(([cx, cz]) => Math.abs(Math.hypot(pts[i] - cx, pts[i + 1] - cz) - 0.8) < 1e-9);
    if (!onArc) throw new Error(`point ${i / 2} (${pts[i]},${pts[i + 1]}) is off the corner arcs`);
  }
  for (let i = 0; i < pts.length; i += 2) {
    const nx = (i + 2) % pts.length;
    if (Math.hypot(pts[i] - pts[nx], pts[i + 1] - pts[nx + 1]) < 1e-9) throw new Error("duplicated consecutive point");
  }
});

test("withKeyingCut_replacesCorner3ArcPointsWithOneDiagonalEdgeKeepsTangents", () => {
  const segs = 4;
  const cut = geometryApi().withKeyingCut(geometryApi().roundedRectProfile(6, 1.7, 0.8, segs), segs);
  if (cut.length / 2 !== 4 * (segs + 1) - (segs - 1)) throw new Error(`expected 17 points, got ${cut.length / 2}`);
  const ring = [];
  for (let i = 0; i < cut.length; i += 2) ring.push([cut[i], cut[i + 1]]);
  const diagonalEdges = ring.filter(([x, z], i) => {
    const [x2, z2] = ring[(i + 1) % ring.length];
    return Math.abs(Math.abs(x2 - x) - 0.8) < 1e-9 && Math.abs(Math.abs(z2 - z) - 0.8) < 1e-9;
  }).length;
  if (diagonalEdges !== 1) throw new Error(`expected exactly one 45deg key edge, got ${diagonalEdges}`);
  const onCorner3Arc = ring.filter(([x, z]) => Math.abs(Math.hypot(x - 2.2, z + 0.05) - 0.8) < 1e-9).length;
  if (onCorner3Arc !== 2) throw new Error(`${onCorner3Arc} points on corner 3's arc, want its 2 tangent points`);
});

test("extrudeProfile_buildsChamferedSlabWithTopAndBottomFaces", () => {
  const sq = [-1, -1, 1, -1, 1, 1, -1, 1]; // CCW square in XZ
  const g = geometryApi().extrudeProfile(sq, { depth: 0.6, chamfer: 0.1 });
  if (!g.idx.length || !g.pos.length) throw new Error("empty extrusion");
  const ys = g.pos.filter((_, i) => i % 3 === 1);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  if (Math.abs(hi - lo - 0.6) > 1e-9) throw new Error(`slab height ${hi - lo}`);
  if (Math.abs(lo) > 1e-9) throw new Error("extrusion should start at y=0");
  const upNormals = g.nrm.filter((_, i) => i % 3 === 1).filter((n) => n > 0.9).length;
  if (upNormals < 2) throw new Error("no top-facing normals");
});

test("circleProfile_extrudedPrism_everyNormalIsACapOrAWallNotTilted", () => {
  // The hinge bar is a circle profile extruded along Y: caps point along +-Y,
  // walls point sideways. Any tilted normal means a profile/axis mixup or an
  // accidental taper in the wall band.
  const g = geometryApi().extrudeProfile(geometryApi().circleProfile(2, 12), { depth: 3 });
  let caps = 0, walls = 0;
  for (let i = 0; i < g.nrm.length; i += 3) {
    const y = Math.abs(g.nrm[i + 1]);
    if (y > 0.999) caps++;
    else if (y < 1e-9) walls++;
    else throw new Error(`tilted normal at vertex ${i / 3}: ${g.nrm[i]},${g.nrm[i + 1]},${g.nrm[i + 2]}`);
  }
  if (!caps || !walls) throw new Error(`caps=${caps} walls=${walls}: a closed prism needs both`);
  const ys = g.pos.filter((_, i) => i % 3 === 1);
  if (Math.max(...ys) - Math.min(...ys) !== 3) throw new Error("prism not 3mm deep along Y");
});

// ------------------------------------------------ land-grid pad field (Task 4)
const layoutApi = () => {
  const a = api();
  for (const fn of ["composeLayout", "buildParts"]) {
    if (typeof a[fn] !== "function") throw new Error(`window.__api.${fn} is not a function`);
  }
  return a;
};

test("composeLayout_defaultGrid_hitsExactly3647Pads_thePackageContactCount", () => {
  // LGA 3647's name is its contact count, so the field we draw had better be
  // the field the package has. The numbers that make it exact: 73 x 53 grid
  // positions = 3,869, minus the ILS window (13x13 = 169) minus the two stems
  // (5 cols x 10 rows = 50) minus the keyed notch (3 x 1 = 3) = 3,647.
  const { instanceCount } = layoutApi().composeLayout();
  if (instanceCount !== 3647) throw new Error(`instanceCount ${instanceCount}, want exactly 3647`);
});

test("composeLayout_default3647Grid_instanceCountFitsTheSocketContactBudget", () => {
  // GIVEN the default LGA 3647 row table,
  // THEN the instanced pad count sits inside the package's land count range.
  const { instanceCount, pads } = layoutApi().composeLayout();
  if (!(instanceCount >= 3400 && instanceCount <= 3800)) {
    throw new Error(`instanceCount ${instanceCount} outside 3400..3800`);
  }
  if (pads.length !== instanceCount) throw new Error(`pads ${pads.length} != instanceCount ${instanceCount}`);
});

test("composeLayout_noPadCentreFallsInsideAnyDeclaredCutoutRect", () => {
  // The central opening is generated by the layout, never painted: any pad whose
  // centre lands inside a declared cutout is a hole that did not get punched.
  const { pads, cutouts } = layoutApi().composeLayout();
  if (!Array.isArray(cutouts) || cutouts.length < 1) throw new Error("layout declares no cutouts");
  for (const p of pads) {
    for (const c of cutouts) {
      const inside = p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1;
      if (inside) throw new Error(`pad (${p.x}, ${p.z}) inside cutout ${c.name}`);
    }
  }
});

test("composeLayout_everyPadCentreSitsInsideTheEnvelopeMinusKeepOut", () => {
  const { grid, pads } = layoutApi().composeLayout();
  const hx = grid.envelope.w / 2 - grid.keepOutMm;
  const hz = grid.envelope.h / 2 - grid.keepOutMm;
  for (const p of pads) {
    if (Math.abs(p.x) > hx || Math.abs(p.z) > hz) {
      throw new Error(`pad (${p.x}, ${p.z}) escapes the ${hx.toFixed(2)} x ${hz.toFixed(2)} keep-out`);
    }
  }
});

test("composeLayout_instanceBufferInterleavesFourFloatsPerPad", () => {
  const { data, instanceCount, pads } = layoutApi().composeLayout();
  // Duck-typed, not `instanceof`: the page runs in its own vm realm, so its
  // Float32Array is a different intrinsic than the harness's. Same shape,
  // different constructor - and gl.bufferData could not care less.
  if (!(data && data.BYTES_PER_ELEMENT === 4 && typeof data.set === "function")) {
    throw new Error("instance buffer must be a Float32Array for gl.bufferData");
  }
  if (data.length !== instanceCount * 4) throw new Error(`data ${data.length} != instanceCount*4 ${instanceCount * 4}`);
  for (let i = 0; i < instanceCount; i++) {
    const [x, z, tone, phase] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
    if (!Number.isFinite(x + z + tone + phase)) throw new Error(`instance ${i} has a non-finite channel`);
    if (!(tone >= 0 && tone <= 1)) throw new Error(`instance ${i} tone ${tone} outside 0..1`);
    if (!(phase >= 0 && phase <= 1)) throw new Error(`instance ${i} phase ${phase} outside 0..1`);
    if (Math.abs(x - pads[i].x) > 1e-6 || Math.abs(z - pads[i].z) > 1e-6) {
      throw new Error(`instance ${i} (${x}, ${z}) disagrees with pads[] (${pads[i].x}, ${pads[i].z})`);
    }
  }
});

test("composeLayout_calledTwice_producesIdenticalInstanceBytes", () => {
  // The tone/phase shimmer must be a pure function of position: a jittering
  // layout would make the pad field shimmer randomly every frame forever.
  const a = layoutApi().composeLayout();
  const b = layoutApi().composeLayout();
  if (a.data.length !== b.data.length) throw new Error("layout is not deterministic: length differs");
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) throw new Error(`byte ${i} differs: ${a.data[i]} vs ${b.data[i]}`);
  }
  const tones = new Set(a.pads.map((p) => p.tone));
  if (tones.size < 2) throw new Error("every pad has the same tone: the field cannot shimmer");
});

test("composeLayout_rowsFlankingTheCentralWindow_areShorterThanTheOutermostRow", () => {
  // Real 3647 shape: the wide arm of the ILS window has a narrow stem above and
  // below it, so the rows nearest that arm carry fewer pads than the edge rows.
  const { rows, cutouts } = layoutApi().composeLayout();
  const window = cutouts.find((c) => c.name.includes("window"));
  if (!window) throw new Error("no ILS window cutout declared");
  const outerRow = rows[0];
  if (rows[rows.length - 1].count !== outerRow.count) throw new Error("the grid is not mirrored in Z");
  for (const sign of [-1, 1]) {
    const flanking = sign < 0
      ? rows.filter((r) => r.z < window.z0).at(-1)
      : rows.find((r) => r.z > window.z1);
    if (!flanking) throw new Error(`no row flanking the window on side ${sign}`);
    if (!(flanking.count < outerRow.count)) {
      throw new Error(`row z=${flanking.z} carries ${flanking.count} pads, outermost carries ${outerRow.count}`);
    }
    if (outerRow.spans.length !== 1) {
      throw new Error(`outermost row has ${outerRow.spans.length} x-spans, want 1 (no cutout touches it)`);
    }
    if (flanking.spans.length !== 2) {
      throw new Error(`row z=${flanking.z} has ${flanking.spans.length} x-spans, want 2 (one stem splits the row)`);
    }
  }
});

test("buildParts_padField_isOnePadMeshInstancedOncePerLayoutPad", () => {
  // One pad mesh, drawn instanceCount times: a 3.6k-mesh pad field would be a
  // 3.6k draw-call field guide, and the frame rate would hate us for it.
  const a = layoutApi();
  const field = a.buildParts().padField;
  const layout = a.composeLayout();
  if (field.instanceCount !== layout.instanceCount) throw new Error("padField.instanceCount disagrees with composeLayout");
  const instancesOk = field.instances && field.instances.BYTES_PER_ELEMENT === 4 && typeof field.instances.set === "function";
  if (!instancesOk) throw new Error("padField has no interleaved Float32 instance buffer");
  if (field.instances.length !== layout.instanceCount * 4) throw new Error("padField instance buffer is not 4 floats per pad");
  const tris = field.geometry.idx.length / 3;
  if (!(tris >= 2 && tris <= 24)) throw new Error(`pad mesh is ${tris} triangles: one micro-plane, not a whole field`);
  if (field.vertexCount > 96) throw new Error(`pad mesh has ${field.vertexCount} vertices: one micro-plane, not a whole field`);
});

test("boot_withWebGL2_reportsPadCountFromTheLayout", () => {
  const { scene, api: pageApi } = boot({ glFactory: () => stubGL() });
  if (scene.padCount !== pageApi.composeLayout().instanceCount) {
    throw new Error(`__scene.padCount is ${scene.padCount}, want ${pageApi.composeLayout().instanceCount}`);
  }
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
