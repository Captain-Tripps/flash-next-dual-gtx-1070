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
  const sandboxAnimationFrameQueue = [];
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
  // A stub drawing buffer the harness controls: Task 5's frameStats probe reads
  // it back through the stub's synthetic fill, so the pixel maths is testable
  // without a GPU.
  canvas.width = 200;
  canvas.height = 100;
  nodes.set("#viewport", canvas);
  nodes.set("#error-overlay", makeNode("div"));
  // The HUD readouts the page writes every frame. The stub has to model them,
  // or the page's own getElementById fallback would hide a missing element.
  for (const id of ["#hud", "#phase", "#padCount", "#azimuth"]) nodes.set(id, makeNode("span"));

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
    // Frames queue instead of firing on their own: the harness must not animate,
    // but a test that wants the rAF loop (fps cadence) can pump the queue below.
    requestAnimationFrame: (cb) => { sandboxAnimationFrameQueue.push(cb); return sandboxAnimationFrameQueue.length; },
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
  // Exposed so boot().pumpFrame can walk the loop instead of leaving it dead.
  sandbox.requestAnimationFrameQueue = sandboxAnimationFrameQueue;
  return { sandbox, canvas, nodes };
}

/** Runs the page's inline module against a stub environment. */
export function boot({ glFactory } = {}) {
  const html = readFileSync(HTML_PATH, "utf8");
  const src = inlineModuleSource(html);
  const { sandbox, canvas, nodes } = makeSandbox({ glFactory });
  runInNewContext(src, createContext(sandbox), { filename: "index.html" });
  return {
    scene: sandbox.window.__scene, api: sandbox.window.__api, canvas, nodes, source: src, html,
    // Drains one queued rAF callback with a given timestamp, so a test can walk
    // the loop forward frame by frame instead of hoping wall time behaves.
    pumpFrame: (timeMs) => {
      const cb = sandbox.requestAnimationFrameQueue?.shift();
      if (!cb) throw new Error("no rAF callback queued: the page does not run a rAF loop");
      cb(timeMs);
    },
  };
}

/**
 * A WebGL2 stub: methods are no-ops and unknown property reads return a
 * catch-all function, so every GL constant also resolves through the proxy
 * (call sites treat constants as identity; the byte-level tests use the
 * recording stub below instead).
 */
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
      getError: () => 0,
      // A deterministic "studio frame": 4 % gold, 26 % lit steel, rest the
      // background gradient. Lets the pixel-analysis tests run against a fake GPU.
      readPixels: (_x, _y, w, h, _fmt, _type, pixels) => {
        for (let p = 0; p < w * h; p++) {
          const i = p * 4;
          const band = p % 50;
          if (band < 2) { pixels[i] = 210; pixels[i + 1] = 175; pixels[i + 2] = 95; }
          else if (band < 15) { pixels[i] = 190; pixels[i + 1] = 196; pixels[i + 2] = 205; }
          else { pixels[i] = 26; pixels[i + 1] = 28; pixels[i + 2] = 33; }
          pixels[i + 3] = 255;
        }
      },
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

/**
 * A WebGL2 stub that records the buffer uploads and attribute pointers the page
 * wires, so the harness can decode the bytes through the pointer table. Real GL
 * keeps attribute locations opaque; handing back the name we were asked for is
 * therefore faithful, and it lets the tests address pointers by name instead of
 * mirroring linker numbers.
 */
export function recordingGL() {
  const log = { uploads: [], attribPointers: [], divisors: [] };
  const bound = { ARRAY_BUFFER: null, ELEMENT_ARRAY_BUFFER: null };
  let nextBufferId = 0;

  const target = {
    log,
    ARRAY_BUFFER: "ARRAY_BUFFER",
    ELEMENT_ARRAY_BUFFER: "ELEMENT_ARRAY_BUFFER",
    STATIC_DRAW: "STATIC_DRAW",
    TRIANGLES: "TRIANGLES",
    FLOAT: "FLOAT",
    UNSIGNED_SHORT: 0x1401,
    UNSIGNED_INT: 0x1405,
    getParameter: () => 0,
    getExtension: () => null,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    getError: () => 0,
    getUniformLocation: (_program, name) => name,
    getAttribLocation: (_program, name) => name,
    createBuffer: () => ({ id: ++nextBufferId, byteLength: 0 }),
    bindBuffer: (where, buffer) => { bound[where] = buffer; },
    bufferData: (where, data) => {
      const buffer = bound[where];
      buffer.byteLength = data.byteLength;
      log.uploads.push({ where, buffer, data });
    },
    vertexAttribPointer: (attrib, size, type, normalized, stride, offset) => {
      log.attribPointers.push({ attrib, size, type, normalized, stride, offset, buffer: bound.ARRAY_BUFFER });
    },
    vertexAttribDivisor: (attrib, divisor) => { log.divisors.push({ attrib, divisor }); },
  };

  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop !== "string") return undefined;
      return (..._args) => ({});
    },
    has: () => true,
  });
}

/** Decodes one attribute out of a recorded upload, exactly as the GPU would. */
function decodeAttrib(upload, pointer, itemCount) {
  const rows = [];
  for (let i = 0; i < itemCount; i++) {
    const baseFloat = (i * pointer.stride + pointer.offset) / 4;
    rows.push(Array.from(upload.data.slice(baseFloat, baseFloat + pointer.size)));
  }
  return rows;
}

/** The upload a pointer was wired against, or a loud failure. */
function uploadOfPointer(gl, attribName) {
  const pointer = gl.log.attribPointers.find((p) => p.attrib === attribName);
  if (!pointer) throw new Error(`no vertexAttribPointer was recorded for ${attribName}`);
  const upload = gl.log.uploads.find((u) => u.buffer === pointer.buffer && u.where === "ARRAY_BUFFER");
  if (!upload) throw new Error(`${attribName} points at a buffer that was never uploaded`);
  return { pointer, upload };
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

/*
 * The hinge swings about the pivot's local X, so every rotation test written
 * about Y only would have kept a broken X-rotation matrix looking fine. The
 * columns of a rotation matrix have to be a right-handed orthonormal basis:
 * anything else quietly shears the plate and its normals mid-swing.
 */
test("mat4_trs_withRotationAboutX_tipsUpTowardForwardAndForwardBackDown", () => {
  const { mat4 } = api();
  const m = mat4.trs(mat4.identity(), { pos: [0, 0, 0], rot: { x: Math.PI / 2 }, scale: 1 });
  near(mat4.transformPoint(new Float64Array(3), m, [0, 1, 0]), [0, 0, 1],
    "right-hand rule about +X: +Y tips toward +Z");
  near(mat4.transformPoint(new Float64Array(3), m, [0, 0, 1]), [0, -1, 0],
    "right-hand rule about +X: +Z tips toward -Y");
});

const linearColumns = (m) => [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];

test("mat4_trs_withCombinedRotations_leavesARigidMatrixWithDeterminantOne", () => {
  const { mat4 } = api();
  const poses = [{ x: 0.7 }, { y: 1.1 }, { z: -0.4 }, { x: 1.83, y: 0.6, z: -1.2 }];
  for (const rot of poses) {
    const m = mat4.trs(mat4.identity(), { pos: [3, 4, 5], rot, scale: 1 });
    const [c0, c1, c2] = linearColumns(m);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    near([dot(c0, c0), dot(c1, c1), dot(c2, c2)], [1, 1, 1], `unit columns for rot ${JSON.stringify(rot)}`);
    near([dot(c0, c1), dot(c0, c2), dot(c1, c2)], [0, 0, 0], `orthogonal columns for rot ${JSON.stringify(rot)}`);
    const det = dot(c0, cross(c1, c2));
    // The matrix lands in a Float32Array, so the determinant can't be exactly 1.
    if (Math.abs(det - 1) > 1e-6) throw new Error(`det(${JSON.stringify(rot)}) = ${det}, want 1 (no mirroring, no shear)`);
  }
});

test("mat4_trs_withAnIsotropicScaleObject_scalesEachAxisSeparately", () => {
  const { mat4 } = api();
  const m = mat4.trs(mat4.identity(), { pos: [0, 0, 0], rot: { y: 0 }, scale: { x: 2, y: 3, z: 4 } });
  near([m[0], m[5], m[10]], [2, 3, 4], "diagonal entries must carry scale.x/y/z");
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

test("worldFloorY_closedLoadPlate_reportsTheHingeHeightSoTheContactShadowSitsOnTheLid", () => {
  // The wiring bug this guards: the renderer used to hand the shader the part's
  // LOCAL bbox min y, which for the load plate is 0 - but the plate lives under a
  // hinge node and actually rests 4+ mm above the substrate plane. Darkening then
  // happened at an imaginary floor.
  const { buildParts, applyPlatePose, worldFloorY, mat4 } = api();
  const parts = buildParts();
  applyPlatePose(parts, { plateAngleDeg: 0, latchAngleDeg: 0 });
  const model = parts.loadPlate.node.world(new Float32Array(16));
  const floor = worldFloorY(model, parts.loadPlate.bbox);
  if (!(floor > 3 && floor < 6)) throw new Error(`closed plate floor ${floor}, want ~4 mm above the substrate`);
});

test("worldFloorY_acrossTheHingeSwing_staysInsideTheLidSweepSoTheContactUniformStaysFinite", () => {
  // Measured semantics (floorprobe2): the contact proxy is the WORLD AABB floor,
  // so it slides down the hinge sweep - 4.25 mm closed, 3.50 at 30deg, 3.06 at
  // 52.5, 2.39 fully open - as the box's low corner swings toward the substrate.
  // That is the conservative choice: contactAO only darkens fragments above the
  // plane, and nothing in this scene sits below y = 2.4. What this test guards is
  // that the value stays finite and sane mid-swing, unlike the old local-bbox
  // constant that ignored the hinge node entirely.
  const { buildParts, applyPlatePose, worldFloorY, mat4 } = api();
  const parts = buildParts();
  const m = new Float32Array(16);
  const cornersOf = (b) => {
    const out = [];
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]])
        for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
    return out;
  };
  const worldTopOf = (mat, b) => {
    const p = new Float64Array(3);
    return Math.max(...cornersOf(b).map((c) => mat4.transformPoint(p, mat, c)[1]));
  };

  applyPlatePose(parts, { plateAngleDeg: 0, latchAngleDeg: 0 });
  parts.loadPlate.node.world(m);
  const closed = {
    floor: worldFloorY(m, parts.loadPlate.bbox),
    top: worldTopOf(m, parts.loadPlate.bbox),
  };
  applyPlatePose(parts, { plateAngleDeg: 52.5, latchAngleDeg: 0 });
  parts.loadPlate.node.world(m);
  const mid = {
    floor: worldFloorY(m, parts.loadPlate.bbox),
    top: worldTopOf(m, parts.loadPlate.bbox),
  };
  applyPlatePose(parts, { plateAngleDeg: 105, latchAngleDeg: 18 });
  parts.loadPlate.node.world(m);
  const open = {
    floor: worldFloorY(m, parts.loadPlate.bbox),
    top: worldTopOf(m, parts.loadPlate.bbox),
  };

  for (const [pose, v] of [["closed", closed], ["mid-swing", mid], ["open", open]]) {
    if (!Number.isFinite(v.floor)) {
      throw new Error(`${pose} floor is ${v.floor}: a NaN uniform would poison the shading`);
    }
    if (!(v.floor > 2 && v.floor < 6)) {
      throw new Error(`${pose} floor ${v.floor}, want inside the lid sweep (2-6 mm)`);
    }
  }
  if (!(open.top > closed.top + 50)) {
    throw new Error(`lid top ${closed.top} closed vs ${open.top} open: the swing must lift the free end`);
  }
});

test("worldFloorY_forAnUnlocatedPart_agreesWithTheLocalBboxMinY_andSurvivesAnEmptyBbox", () => {
  const { mat4, worldFloorY, bboxOf } = api();
  const box = { min: [-2, 3, -4], max: [2, 7, 4] };
  const identity = mat4.identity();
  if (worldFloorY(identity, box) !== 3) throw new Error("unlocated part should report its own bbox floor");
  const lifted = mat4.trs(mat4.identity(), { pos: [0, 10, 0], rot: { y: 0 }, scale: 1 });
  if (worldFloorY(lifted, box) !== 13) throw new Error("a lifted part must follow its floor");
  // An empty geometry (a transform-only node) has a null bbox: it must not hand a
  // NaN into a uniform or the whole part's shading goes to NaN.
  const empty = worldFloorY(identity, bboxOf([]));
  if (empty !== 0 || !Number.isFinite(empty)) throw new Error(`empty bbox floor ${empty}, want a finite 0`);
});

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

test("buildParts_exposesTheSocketPartsAndTheirHingePivot", () => {
  const a = geometryApi();
  const parts = a.buildParts();
  const want = ["substrate", "frame", "padField", "brBracket", "loadPlate", "hingeBar", "latchLever", "stiffenRing", "hingePivot"];
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
    if (!idx.length) {
      // The hinge pivot is a transform node by design (a dedicated test asserts
      // it carries no geometry); every other empty buffer is a bug.
      if (name !== "hingePivot") throw new Error(`${name}: empty index buffer`);
      continue;
    }
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

// ------------------------------------------------ materials & shaders (Task 5)
const renderApi = () => {
  const a = api();
  for (const fn of ["analysePixels", "drawScene", "frameStats"]) {
    if (typeof a[fn] !== "function") throw new Error(`window.__api.${fn} is not a function`);
  }
  return a;
};

/** Builds a RGBA framebuffer where `pred(x, y)` decides which pixels are lit. */
function syntheticFrame(width, height, pred) {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gold = pred(x, y) === "gold";
      const lit = pred(x, y) === true || gold;
      if (gold) { px[i] = 210; px[i + 1] = 170; px[i + 2] = 90; }
      else if (lit) { px[i] = 200; px[i + 1] = 205; px[i + 2] = 210; }
      else { px[i] = 30; px[i + 1] = 32; px[i + 2] = 36; }
      px[i + 3] = 255;
    }
  }
  return px;
}

test("analysePixels_allBackground_countsNoCoverageOrGold", () => {
  const px = syntheticFrame(20, 10, () => false);
  const s = renderApi().analysePixels(px, 20, 10);
  if (s.nonBackgroundCount !== 0 || s.goldCount !== 0) {
    throw new Error(`dark frame reported coverage ${s.nonBackgroundRatio}, gold ${s.goldRatio}`);
  }
  if (s.sampled !== 200) throw new Error(`sampled ${s.sampled}, want 200`);
});

test("analysePixels_withAMixedFrame_reportsCoverageAndGoldRatios", () => {
  // 20x10 = 200 pixels: half lit, one in ten gold.
  const px = syntheticFrame(20, 10, (x, y) => (x < 10 ? (x === 0 ? "gold" : true) : false));
  const s = renderApi().analysePixels(px, 20, 10);
  if (s.nonBackgroundCount !== 100) throw new Error(`coverage count ${s.nonBackgroundCount}, want 100`);
  if (Math.abs(s.nonBackgroundRatio - 0.5) > 1e-6) throw new Error(`coverage ratio ${s.nonBackgroundRatio}, want 0.5`);
  if (s.goldCount !== 10) throw new Error(`gold count ${s.goldCount}, want 10`);
  if (Math.abs(s.goldRatio - 0.05) > 1e-6) throw new Error(`gold ratio ${s.goldRatio}, want 0.05`);
});

test("analysePixels_goldRule_rejectsBlueAndMutedReds", () => {
  // The hue rule is r > b + 20 && g > 60: blues, near-white greys and dark reds
  // must not pass, otherwise the probe would count the wrong thing gold.
  const width = 5, height = 1;
  const px = new Uint8Array(width * height * 4);
  const cases = [
    [40, 60, 200, false],  // blue
    [200, 200, 200, false], // neutral grey
    [100, 40, 40, false],  // dark red (g too low)
    [120, 90, 60, true],   // muted gold, still gold
    [250, 200, 120, true], // bright gold
  ];
  cases.forEach(([r, g, b], idx) => {
    px[idx * 4] = r; px[idx * 4 + 1] = g; px[idx * 4 + 2] = b; px[idx * 4 + 3] = 255;
  });
  const s = renderApi().analysePixels(px, width, height);
  if (s.sampled !== cases.length) {
    throw new Error(`frame holds ${s.sampled} pixels but the test wrote ${cases.length} cases`);
  }
  const wantGold = cases.filter((c) => c[3]).length;
  if (s.goldCount !== wantGold) throw new Error(`gold ${s.goldCount} of ${cases.length}, want ${wantGold}`);
});

test("analysePixels_samplesEveryNthPixel_whenStepGiven", () => {
  const px = syntheticFrame(20, 10, () => false);
  const s = renderApi().analysePixels(px, 20, 10, { step: 2 });
  if (s.sampled !== 50) throw new Error(`step 2 sampled ${s.sampled}, want 50 (10 x 5 grid)`);
});

test("boot_withWebGL2_recordsCompileAndLinkStatusForTheStdAndPadPrograms", () => {
  const { scene } = boot({ glFactory: () => stubGL() });
  const programs = scene.programs || {};
  for (const name of ["std", "pad"]) {
    const p = programs[name];
    if (!p) throw new Error(`no program diagnostics for "${name}" (have [${Object.keys(programs)}])`);
    if (!p.compiled || !p.linked) throw new Error(`${name} did not compile/link: ${JSON.stringify(p)}`);
    if ((p.infoLog || "") !== "") throw new Error(`${name} info log: ${p.infoLog}`);
  }
});

test("boot_withWebGL2_drawScene_countsOneDrawPerPartPlusTheInstancedPadField", () => {
  const { scene, api: pageApi } = boot({ glFactory: () => stubGL() });
  const viewProj = pageApi.mat4.identity();
  pageApi.drawScene(viewProj, 0);
  // Only parts with geometry get a draw call; the hinge pivot rotates and
  // nothing else, so counting scene.parts keys would expect a phantom draw.
  const drawableParts = Object.values(scene.parts).filter((p) => p.indexCount > 0).length;
  if (scene.parts.hingePivot && scene.parts.hingePivot.indexCount !== 0) {
    throw new Error("the hinge pivot somehow carries geometry");
  }
  if (scene.drawCalls !== drawableParts) {
    throw new Error(`drawCalls ${scene.drawCalls}, want one per drawable part (${drawableParts})`);
  }
  if (scene.padsDrawn !== scene.padCount) throw new Error(`padsDrawn ${scene.padsDrawn}, want ${scene.padCount}`);
});

/*
 * The 60 fps gate (DESIGN.md) needs a number produced inside the page, not one
 * inferred from screenshot latency. The loop has to publish its own cadence, so
 * the render suite can sample fps/lastFrameMs in real Chrome. Pumping the queue
 * with fake timestamps proves the contract without waiting on wall clock.
 */
test("renderLoop_pumpedWithFakeTimestamps_publishesFrameCadenceOnTheScene", () => {
  const { scene, pumpFrame } = boot({ glFactory: () => stubGL() });
  if (!Number.isFinite(scene.fps) || !Number.isFinite(scene.lastFrameMs)) {
    throw new Error(`boot published fps ${scene.fps}, lastFrameMs ${scene.lastFrameMs}: both must be numbers`);
  }
  for (const t of [116.5, 133.2, 149.9]) {
    pumpFrame(t);
  }
  if (Math.abs(scene.lastFrameMs - 16.7) > 0.05) {
    throw new Error(`lastFrameMs ${scene.lastFrameMs}, want 16.7 (the gap between pumped timestamps)`);
  }
  if (Math.abs(scene.fps - 1000 / 16.7) > 0.01) {
    throw new Error(`fps ${scene.fps}, want ${1000 / 16.7} (derived from the published gap)`);
  }
});

test("frameStats_withStubbedReadPixels_reportsTheSyntheticFrameRatios", () => {
  // The stub fills its 200x100 buffer with 30 % lit pixels, 4 % gold-ish.
  const { api: pageApi } = boot({ glFactory: () => stubGL() });
  pageApi.drawScene(pageApi.mat4.identity(), 0);
  const s = pageApi.frameStats();
  if (Math.abs(s.nonBackgroundRatio - 0.3) > 1e-6) throw new Error(`coverage ${s.nonBackgroundRatio}, want 0.3`);
  if (Math.abs(s.goldRatio - 0.04) > 1e-6) throw new Error(`gold ${s.goldRatio}, want 0.04`);
  if (!(s.maxLuma > 100)) throw new Error(`maxLuma ${s.maxLuma}`);
});

// ------------------------------------------------ camera orbit + viewport (Task 6)
const cameraApi = () => {
  const a = api();
  for (const fn of ["cameraPose", "orbit", "zoom", "fitViewport"]) {
    if (typeof a[fn] !== "function") throw new Error(`window.__api.${fn} is not a function`);
  }
  for (const obj of ["ORBIT", "CAMERA_LIMITS"]) {
    if (!a[obj]) throw new Error(`window.__api.${obj} is missing`);
  }
  return a;
};

test("cameraPose_atZeroElapsed_startsAtThePublishedShowcasePose", () => {
  const { cameraPose, VIEW, CAMERA_LIMITS } = cameraApi();
  const p = cameraPose(0);
  if (p.azDeg !== VIEW.azDeg) throw new Error(`azimuth ${p.azDeg}, want ${VIEW.azDeg}`);
  if (!(p.elevDeg >= CAMERA_LIMITS.minElevDeg && p.elevDeg <= CAMERA_LIMITS.maxElevDeg)) {
    throw new Error(`elevation ${p.elevDeg} outside [${CAMERA_LIMITS.minElevDeg}, ${CAMERA_LIMITS.maxElevDeg}]`);
  }
  if (p.dist !== VIEW.dist) throw new Error(`dist ${p.dist}, want ${VIEW.dist}`);
  if (!p.eye.every((v) => Number.isFinite(v))) throw new Error(`eye ${JSON.stringify(p.eye)} is not finite`);
});

test("cameraPose_overTenSeconds_advancesAzimuthByItsPublishedRateOfFourDegreesPerSecond", () => {
  const { cameraPose, ORBIT } = cameraApi();
  const delta = cameraPose(10_000).azDeg - cameraPose(0).azDeg;
  const want = (ORBIT.degPerMs * 10_000);
  if (Math.abs(delta - want) > 1e-6) throw new Error(`10 s advanced azimuth ${delta}, want ${want}`);
  // Sanity: the plan's "slow" must still be a visible rotation. 30-60 deg per
  // 10 s is the range the render probe needs for the pad field to shimmer.
  if (!(delta >= 30 && delta <= 60)) throw new Error(`10 s advanced ${delta} deg, want 30-60 (visible rotation)`);
});

test("cameraPose_acrossAFullDriftPeriod_keepsElevationInsideTheLimits_andDriftsBackAndForth", () => {
  const { cameraPose, ORBIT, CAMERA_LIMITS } = cameraApi();
  const period = ORBIT.elevPeriodMs;
  let min = Infinity, max = -Infinity;
  for (let ms = 0; ms <= 3 * period; ms += 500) {
    const e = cameraPose(ms).elevDeg;
    if (e < min) min = e;
    if (e > max) max = e;
    if (!(e >= CAMERA_LIMITS.minElevDeg && e <= CAMERA_LIMITS.maxElevDeg)) {
      throw new Error(`elevation ${e} at t=${ms} ms outside the limits`);
    }
  }
  const swing = max - min;
  if (swing <= 0) throw new Error(`elevation never drifted: min ${min} max ${max}`);
  if (swing > 2 * ORBIT.elevAmplitudeDeg + 1e-9) {
    throw new Error(`elevation swings ${swing} deg, want <= 2 x amplitude (${ORBIT.elevAmplitudeDeg})`);
  }
});

test("orbit_withADragDelta_rollsAzimuthByItsPerPixelRate_andClampsElevationAfterAHugeDrag", () => {
  const { orbit, cameraPose, ORBIT, CAMERA_LIMITS } = cameraApi();
  const before = cameraPose(0).azDeg;
  orbit(80, 0);
  const after = cameraPose(0);
  const delta = after.azDeg - before;
  if (Math.abs(delta - 80 * ORBIT.dragDegPerPx) > 1e-6) {
    throw new Error(`80 px advanced azimuth ${delta}, want ${80 * ORBIT.dragDegPerPx}`);
  }
  orbit(-1e6, -1e6); // drag far "up": elevation must saturate, not overshoot
  const high = cameraPose(0);
  if (high.elevDeg > CAMERA_LIMITS.maxElevDeg || high.elevDeg < CAMERA_LIMITS.minElevDeg) {
    throw new Error(`after a huge drag: elevation ${high.elevDeg} outside the limits`);
  }
  orbit(1e6, 1e6); // and the other way
  const low = cameraPose(0);
  if (low.elevDeg > CAMERA_LIMITS.maxElevDeg || low.elevDeg < CAMERA_LIMITS.minElevDeg) {
    throw new Error(`after the opposite drag: elevation ${low.elevDeg} outside the limits`);
  }
});

test("zoom_withExtremeInwardAndOutwardInput_staysInsideRadiusLimits_andNeverReachesZero", () => {
  const { zoom, cameraPose, CAMERA_LIMITS } = cameraApi();
  const start = cameraPose(0).dist;
  zoom(3);
  const out = cameraPose(0).dist;
  if (!(out > start)) throw new Error(`zoom(+3) moved dist ${start} -> ${out}, want it to increase`);
  zoom(-1e6);
  const minD = cameraPose(0).dist;
  if (!(minD > 0)) throw new Error(`radius went to ${minD}`);
  if (minD < CAMERA_LIMITS.minDist || minD > CAMERA_LIMITS.maxDist) {
    throw new Error(`after zooming right in: dist ${minD} outside [${CAMERA_LIMITS.minDist}, ${CAMERA_LIMITS.maxDist}]`);
  }
  zoom(1e6);
  const maxD = cameraPose(0).dist;
  if (maxD > CAMERA_LIMITS.maxDist) throw new Error(`after zooming right out: dist ${maxD}`);
});

test("fitViewport_withZeroHeightOrAnExtremeBox_clampsAspectIntoTheRange", () => {
  const { fitViewport, CAMERA_LIMITS } = cameraApi();
  for (const [w, h] of [[1600, 0], [0, 900], [2560, 1080], [100, 100000], [100000, 100]]) {
    const vp = fitViewport(w, h, 1);
    if (!(vp.aspect >= CAMERA_LIMITS.minAspect && vp.aspect <= CAMERA_LIMITS.maxAspect)) {
      throw new Error(`${w}x${h}: aspect ${vp.aspect} outside [${CAMERA_LIMITS.minAspect}, ${CAMERA_LIMITS.maxAspect}]`);
    }
    if (!(vp.width > 0 && vp.height > 0)) throw new Error(`${w}x${h}: backing ${vp.width}x${vp.height}`);
  }
});

test("fitViewport_returnsAnAspectAStandardPerspectiveCanBeBuiltFrom", () => {
  const { fitViewport, mat4 } = cameraApi();
  const vp = fitViewport(2560, 1080, 1);
  if (vp.width !== 2560 || vp.height !== 1080) throw new Error(`backing ${vp.width}x${vp.height}, want 2560x1080`);
  const proj = mat4.perspective(mat4.identity(), { fovyDeg: 30, aspect: vp.aspect, near: 1, far: 4000 });
  if (!proj.every((v) => Number.isFinite(v))) throw new Error(`non-finite perspective for ${JSON.stringify(vp)}`);
});

test("fitViewport_at4xDpr_capsTheDevicePixelRatioAndScalesTheCssBoxToTheBackingStore", () => {
  const { fitViewport, CAMERA_LIMITS } = cameraApi();
  const vp = fitViewport(1200, 800, 4);
  if (vp.dpr > CAMERA_LIMITS.maxDpr) throw new Error(`dpr ${vp.dpr} above the cap ${CAMERA_LIMITS.maxDpr}`);
  if (vp.width !== 1200 * CAMERA_LIMITS.maxDpr) throw new Error(`width ${vp.width}, want ${1200 * CAMERA_LIMITS.maxDpr}`);
  if (vp.height !== 800 * CAMERA_LIMITS.maxDpr) throw new Error(`height ${vp.height}`);
});

test("resizeCanvas_withAStubCssBox_resizesTheCanvasBackingStoreToFitViewport", () => {
  // Drive-then-assert: the end state is the canvas element's own width/height,
  // not a return value nobody reads.
  const { api: pageApi, canvas } = boot({ glFactory: () => stubGL() });
  canvas.clientWidth = 400;
  canvas.clientHeight = 250;
  pageApi.resizeCanvas(stubGL(), canvas);
  const vp = pageApi.fitViewport(400, 250, 1);
  if (canvas.width !== vp.width || canvas.height !== vp.height) {
    throw new Error(`backing store ${canvas.width}x${canvas.height}, want ${vp.width}x${vp.height}`);
  }
});

test("advanceOrbitClock_withAFiveSecondHiddenTabDelta_stepsTheElapsedClockByAtMostMaxFrameMs", () => {
  const { advanceOrbitClock, orbitClock, cameraPose, VIEW, ORBIT, MAX_FRAME_MS } = cameraApi();
  const before = orbitClock.elapsedMs;
  const step = advanceOrbitClock(5000);
  if (step !== MAX_FRAME_MS) throw new Error(`returned delta ${step}, want the clamp ${MAX_FRAME_MS}`);
  const advanced = orbitClock.elapsedMs - before;
  if (advanced !== MAX_FRAME_MS) throw new Error(`clock advanced by ${advanced}, want ${MAX_FRAME_MS}`);
  // And the pose itself must not have jumped the whole 5 s.
  const jumped = cameraPose(orbitClock.elapsedMs).azDeg - (VIEW.azDeg + before * ORBIT.degPerMs);
  if (Math.abs(jumped - MAX_FRAME_MS * ORBIT.degPerMs) > 1e-9) {
    throw new Error(`azimuth moved ${jumped} deg, want ${MAX_FRAME_MS * ORBIT.degPerMs}`);
  }
});

test("advanceOrbitClock_whenPaused_withDelta_shouldNotAdvanceTheElapsedClock", () => {
  const { advanceOrbitClock, orbitClock, cameraPose } = cameraApi();
  const frozen = cameraPose(orbitClock.elapsedMs).azDeg;
  orbitClock.paused = true;
  try {
    advanceOrbitClock(1000);
    advanceOrbitClock(1000);
  } finally {
    orbitClock.paused = false;
  }
  if (cameraPose(orbitClock.elapsedMs).azDeg !== frozen) {
    throw new Error("a paused clock still advanced the azimuth");
  }
  if (advanceOrbitClock(-25) !== 0) throw new Error("a negative delta must clamp to 0");
});

// ---------------------------------------------- load plate hinge cycle + HUD (Task 7)
const plateApi = () => {
  const a = api();
  for (const fn of ["platePose", "applyPlatePose", "setPlateOverride", "handleKey"]) {
    if (typeof a[fn] !== "function") throw new Error(`window.__api.${fn} is not a function`);
  }
  if (!a.PLATE_CYCLE) throw new Error("window.__api.PLATE_CYCLE is missing");
  return a;
};

/*
 * The hinge line of the model, in millimetres, as hard constants on purpose:
 * a reparenting bug that moves the pivot silently moves the whole plate-and-rod
 * assembly, and the only way to catch it is to compare against real numbers.
 * HINGE_Y = substrate top (0.8) + ILS band (0.05) + rod riser (3.4); the rod
 * centreline is the pivot, so the plate hangs from it with no local offset.
 * HINGE_Z = land-grid half-depth (30.7) + rod offset (3.5).
 */
const HINGE_LINE = [0, 4.25, 34.2];

test("platePose_atZeroElapsed_reportsTheClosedPhaseWithBothAnglesAtZero", () => {
  const { platePose } = plateApi();
  const pose = platePose(0);
  if (pose.phase !== "closed") throw new Error(`phase at t=0 is "${pose.phase}", want closed`);
  if (pose.plateAngleDeg !== 0) throw new Error(`plate angle ${pose.plateAngleDeg}, want 0`);
  if (pose.latchAngleDeg !== 0) throw new Error(`latch angle ${pose.latchAngleDeg}, want 0`);
});

test("platePose_overOneFullCycle_visitsTheFiveNamedPhasesInOrder", () => {
  const { platePose, PLATE_CYCLE } = plateApi();
  const seen = [];
  // Sampling past the wrap point on purpose: the cycle must re-enter "closed"
  // at the end rather than jump from "closing" straight back to "opening".
  for (let t = 0; t <= PLATE_CYCLE.cycleMs + 120; t += 120) {
    const phase = platePose(t).phase;
    if (seen[seen.length - 1] !== phase) seen.push(phase);
  }
  const want = ["closed", "unlatching", "opening", "open", "closing", "closed"];
  if (seen.join(",") !== want.join(",")) throw new Error(`phases visited: ${seen.join(",")} (want ${want.join(",")})`);
});

test("platePose_atTheEndOfOpening_reachesAtLeast104DegreesAndHoldsItWhileOpen", () => {
  const { platePose, PLATE_CYCLE } = plateApi();
  const open = PLATE_CYCLE.keyframes.find((k) => k.phase === "open");
  const at = platePose(open.atMs - 1).plateAngleDeg;
  if (!(at >= 104)) throw new Error(`plate angle at the end of opening is ${at}, want >= 104`);
  for (let t = open.atMs; t < open.atMs + 1500; t += 100) {
    const p = platePose(t);
    if (p.phase !== "open") throw new Error(`t=${t}: phase "${p.phase}", want open`);
    if (p.plateAngleDeg < 104) throw new Error(`t=${t}: open phase dropped the plate to ${p.plateAngleDeg}`);
  }
});

test("platePose_byTheEndOfClosing_backReturnsThePlateToZeroDegrees", () => {
  const { platePose, PLATE_CYCLE } = plateApi();
  const closing = PLATE_CYCLE.keyframes.find((k) => k.phase === "closing");
  const next = PLATE_CYCLE.keyframes.find((k) => k.atMs > closing.atMs);
  const at = platePose(next.atMs).plateAngleDeg;
  if (Math.abs(at) > 1e-9) throw new Error(`plate angle after closing is ${at}, want 0`);
});

test("platePose_whileThePhaseIsClosed_latchAngleStaysAtZero", () => {
  const { platePose, PLATE_CYCLE } = plateApi();
  for (let t = 0; t < PLATE_CYCLE.cycleMs; t += 37) {
    const p = platePose(t);
    if (p.phase === "closed" && p.latchAngleDeg !== 0) {
      throw new Error(`t=${t}: closed phase has a swung latch (${p.latchAngleDeg} deg)`);
    }
  }
});

test("platePose_atTheCycleWrap_andAtZero_shouldReturnIdenticalValues", () => {
  const { platePose, PLATE_CYCLE } = plateApi();
  const a = JSON.stringify(platePose(0));
  const b = JSON.stringify(platePose(PLATE_CYCLE.cycleMs));
  if (a !== b) throw new Error(`cycle does not wrap: ${a} vs ${b}`);
});

test("setPlateOverride_withZeroFalsyPin_andReleaseRestoresTheFreeCyclePose", () => {
  const { platePose, setPlateOverride, PLATE_CYCLE } = plateApi();
  const mid = PLATE_CYCLE.cycleMs / 2;
  const free = JSON.stringify(platePose(mid));

  // WHEN the pin is 0 (a falsy angle), THEN it must still pin the plate closed:
  // the release sentinel has to be null, not "any falsy value".
  setPlateOverride(0);
  const pinned = platePose(mid);
  if (pinned.plateAngleDeg !== 0) throw new Error(`falsy pin reported ${pinned.plateAngleDeg}, want 0`);
  if (pinned.phase !== "closed") throw new Error(`falsy pin reported phase "${pinned.phase}"`);

  // THEN releasing with null returns the identical cycle pose, unpinned.
  setPlateOverride(null);
  if (JSON.stringify(platePose(mid)) !== free) {
    throw new Error(`release left the cycle at ${JSON.stringify(platePose(mid))}, was ${free}`);
  }
});

test("applyPlatePose_at105Degrees_keepsTheHingeLineFixedAndLiftsThePlateTip", () => {
  const { applyPlatePose, mat4, buildParts } = plateApi();
  const parts = buildParts();
  const worldOf = (part) => part.node.world(new Float32Array(16));
  const pointAt = (m, p) => mat4.transformPoint(new Float64Array(3), m, p);

  applyPlatePose(parts, { plateAngleDeg: 0, latchAngleDeg: 0 });
  const closedOrigin = pointAt(worldOf(parts.loadPlate), [0, 0, 0]);
  const closedTip = pointAt(worldOf(parts.loadPlate), [0, 0, -68]);

  applyPlatePose(parts, { plateAngleDeg: 105, latchAngleDeg: 18 });
  const openOrigin = pointAt(worldOf(parts.loadPlate), [0, 0, 0]);
  const openTip = pointAt(worldOf(parts.loadPlate), [0, 0, -68]);

  for (let i = 0; i < 3; i++) {
    if (Math.abs(openOrigin[i] - closedOrigin[i]) > 1e-4) {
      throw new Error(`hinge line drifted ${JSON.stringify(closedOrigin)} -> ${JSON.stringify(openOrigin)}`);
    }
    if (Math.abs(closedOrigin[i] - HINGE_LINE[i]) > 1e-3) {
      throw new Error(`hinge line is ${JSON.stringify(closedOrigin)}, want ${JSON.stringify(HINGE_LINE)}`);
    }
  }
  if (!(openTip[1] > closedTip[1] + 50)) {
    throw new Error(`plate tip did not lift: y ${closedTip[1].toFixed(1)} -> ${openTip[1].toFixed(1)}`);
  }
  // 105deg leans the tip back past vertical and over the hinge side, so the tip
  // ends up north of the socket rather than above the land grid.
  if (!(openTip[2] > HINGE_LINE[2])) {
    throw new Error(`plate tip stayed over the field at z=${openTip[2].toFixed(1)}, want past the hinge`);
  }
});

/*
 * Every sample in the test above sits on the plate's y = 0 plane, where a
 * rotation matrix that has lost its X-rotation terms happens to agree with the
 * right one. A corner off that plane catches the shear: a 105deg swing must keep
 * the plate's own diagonals the same length, thickness included.
 */
test("applyPlatePose_at105Degrees_keepsPlateDiagonalsRigidAwayFromTheHingePlane", () => {
  const { applyPlatePose, mat4, buildParts } = plateApi();
  const parts = buildParts();
  const corners = [];
  for (const x of [parts.loadPlate.bbox.min[0], parts.loadPlate.bbox.max[0]])
    for (const y of [parts.loadPlate.bbox.min[1], parts.loadPlate.bbox.max[1]])
      for (const z of [parts.loadPlate.bbox.min[2], parts.loadPlate.bbox.max[2]])
        corners.push([x, y, z]);

  const distanceInWorld = (matrix, a, b) => {
    const pa = mat4.transformPoint(new Float64Array(3), matrix, a);
    const pb = mat4.transformPoint(new Float64Array(3), matrix, b);
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  };

  applyPlatePose(parts, { plateAngleDeg: 0, latchAngleDeg: 0 });
  const closed = parts.loadPlate.node.world(new Float32Array(16));
  applyPlatePose(parts, { plateAngleDeg: 105, latchAngleDeg: 18 });
  const open = parts.loadPlate.node.world(new Float32Array(16));

  for (const [a, opposite] of [[0, 7], [1, 6], [2, 5], [3, 4]]) {
    const before = distanceInWorld(closed, corners[a], corners[opposite]);
    const after = distanceInWorld(open, corners[a], corners[opposite]);
    if (Math.abs(before - after) > 1e-6) {
      throw new Error(`plate diagonal ${a}-${opposite} stretched ${before.toFixed(3)} -> ${after.toFixed(3)} mm at 105deg`);
    }
  }
});

// One rotation on the pivot must drive both the plate and the rod collar, so
// they cannot disagree about how far the plate swung.
test("buildParts_hingePivot_parentsTheLoadPlateAndHingeBarSoOneRotationDrivesBoth", () => {
  const parts = plateApi().buildParts();
  for (const name of ["loadPlate", "hingeBar"]) {
    if (parts[name].node.parent !== parts.hingePivot.node) {
      throw new Error(`${name} is not a child of the hinge pivot (${parts[name].node.parent && parts[name].node.parent.name})`);
    }
  }
  if (parts.hingePivot.geometry.idx.length !== 0) {
    throw new Error("the hinge pivot is a transform node: it must carry no geometry of its own");
  }
});

test("handleKey_withSpace_pinsClosed_thenOpen_then_returnsToTheAutoCycle", () => {
  const { handleKey, platePose, PLATE_CYCLE, setPlateOverride } = plateApi();
  setPlateOverride(null);
  const mid = PLATE_CYCLE.cycleMs / 2;
  const free = JSON.stringify(platePose(mid));

  if (!handleKey("Space")) throw new Error("Space was not handled at all");
  const first = platePose(mid);
  if (first.plateAngleDeg !== 0) throw new Error(`first Space pinned ${first.plateAngleDeg}, want 0 (closed)`);

  handleKey("Space");
  const second = platePose(mid);
  if (!(second.plateAngleDeg > 100)) throw new Error(`second Space pinned ${second.plateAngleDeg}, want open`);

  handleKey("Space");
  if (JSON.stringify(platePose(mid)) !== free) {
    throw new Error(`third Space did not return the auto cycle: ${JSON.stringify(platePose(mid))} (was ${free})`);
  }
});

test("handleKey_withKeyA_freezesThenResumesTheAnimationClockWithoutMovingIt", () => {
  const { handleKey, orbitClock } = plateApi();
  orbitClock.paused = false;
  const before = orbitClock.elapsedMs;

  if (!handleKey("KeyA")) throw new Error("KeyA was not handled at all");
  if (orbitClock.paused !== true) throw new Error("KeyA did not pause the auto-orbit");
  if (orbitClock.elapsedMs !== before) throw new Error("pausing moved the clock instead of freezing it");

  handleKey("KeyA");
  if (orbitClock.paused !== false) throw new Error("second KeyA did not resume the auto-orbit");
});

// Review-focus invariant: a hidden tab that hands back a 5 s delta must not be
// allowed to snap the cycle to its end pose, because the showcase would then
// visibly jump rather than animate.
test("advanceOrbitClock_withAHugeHiddenTabDelta_clampsTheStepSoThePlateCycleCannotSnapToItsEndPose", () => {
  const { advanceOrbitClock, orbitClock, MAX_FRAME_MS, platePose } = plateApi();
  orbitClock.paused = false;
  orbitClock.elapsedMs = 0;

  const step = advanceOrbitClock(5000);
  if (step > MAX_FRAME_MS) throw new Error(`unclamped step ${step} ms exceeds MAX_FRAME_MS ${MAX_FRAME_MS}`);
  if (orbitClock.elapsedMs > MAX_FRAME_MS) {
    throw new Error(`clock jumped to ${orbitClock.elapsedMs} ms in one frame (max ${MAX_FRAME_MS})`);
  }
  const pose = platePose(orbitClock.elapsedMs);
  if (pose.phase !== "closed") throw new Error(`one clamped frame landed in phase "${pose.phase}"`);
  if (Math.abs(pose.plateAngleDeg) > 0.5) throw new Error(`one clamped frame opened the plate to ${pose.plateAngleDeg}`);
});

test("boot_withWebGL2_writesPhaseAzimuthAndPadCountIntoTheHudNodes", () => {
  const { nodes } = boot({ glFactory: () => stubGL() });
  const read = (id) => {
    const node = nodes.get(id);
    if (!node) throw new Error(`HUD node ${id} missing from the page markup`);
    return node.textContent;
  };
  const phase = read("#phase");
  const pads = read("#padCount");
  const azimuth = read("#azimuth");
  if (!["closed", "unlatching", "opening", "open", "closing"].includes(phase)) {
    throw new Error(`#phase textContent is "${phase}"`);
  }
  if (pads !== String(3647)) throw new Error(`#padCount is "${pads}", want 3647`);
  if (!/^-?\d+(\.\d+)?°$/.test(azimuth)) throw new Error(`#azimuth is "${azimuth}", want a degree readout`);
});

// ---------------------------------------------------------------- GL plumbing
/*
 * Buffer layout and attribute pointers are the two things most likely to be
 * wrong and least likely to be noticed: a mismatch compiles, links and draws
 * without a single GL error, reading whatever bytes sit at the pointer's offset.
 * So these tests decode the uploaded bytes through the pointer table the page
 * actually wired, and compare them against the CPU geometry it built.
 */
const pointerFor = (gl, name) => {
  const pointer = gl.log.attribPointers.find((p) => p.attrib === name);
  if (!pointer) throw new Error(`no vertexAttribPointer recorded for ${name}`);
  return pointer;
};

const arrayUploadFor = (gl, name) => {
  const pointer = pointerFor(gl, name);
  const upload = gl.log.uploads.find((u) => u.buffer === pointer.buffer && u.where === "ARRAY_BUFFER");
  if (!upload) throw new Error(`${name} is wired to a buffer that was never uploaded`);
  return upload;
};

test("uploadPartToGpu_withTwoVertices_storesPositionAndNormalPerVertexAndPointsAtBoth", () => {
  const gl = recordingGL();
  const { uploadPartToGpu, STRIDE_BYTES } = api();
  const geometry = {
    pos: [-1, -2, -3, 7, 8, 9],
    nrm: [0, 1, 0, 0, -1, 0],
    idx: [0, 1, 0],
  };
  uploadPartToGpu(gl, { name: "probe", geometry }, { attribs: { a_pos: "a_pos", a_normal: "a_normal" } });

  const upload = arrayUploadFor(gl, "a_pos");
  if (upload.data.length !== 12) throw new Error(`expected 12 floats for 2 verts, got ${upload.data.length}`);
  const vertexCount = geometry.pos.length / 3;
  const decoded = (name) => decodeAttrib(upload, pointerFor(gl, name), vertexCount);
  near(decoded("a_pos").flat(), geometry.pos, "a_pos must read one position per vertex");
  near(decoded("a_normal").flat(), geometry.nrm, "a_normal must read one normal per vertex");

  for (const name of ["a_pos", "a_normal"]) {
    const { stride, offset, size } = pointerFor(gl, name);
    if (stride !== STRIDE_BYTES) throw new Error(`${name} stride ${stride}, want ${STRIDE_BYTES}`);
    if (offset + size * 4 > stride) throw new Error(`${name} reads ${offset}..${offset + size * 4} past stride ${stride}`);
  }
});

test("uploadPartToGpu_withInterleavedXzTonePhaseInstances_usesTheFourFloatsPerPadCorrectly", () => {
  const gl = recordingGL();
  const { uploadPartToGpu, STRIDE_BYTES } = api();
  const instances = new Float32Array([
    -5, 6, 0.9, 0.25,
    20, -21, 0.2, 0.75,
  ]);
  const geometry = { pos: [0, 0, 0, 1, 1, 1], nrm: [0, 1, 0, 0, 1, 0], idx: [0, 1] };
  const rec = { attribs: { a_pos: "a_pos", a_normal: "a_normal", a_padXZ: "a_padXZ", a_padTone: "a_padTone" } };
  uploadPartToGpu(gl, { name: "padField", geometry, instances }, rec);

  const upload = arrayUploadFor(gl, "a_padXZ");
  const pads = instances.length / 4;
  const xz = decodeAttrib(upload, pointerFor(gl, "a_padXZ"), pads);
  const tone = decodeAttrib(upload, pointerFor(gl, "a_padTone"), pads);
  near(xz.flat(), [-5, 6, 20, -21], "each pad must get its own x/z offset");
  near(tone.flat(), [0.9, 0.25, 0.2, 0.75], "each pad must get its own tone and phase");

  for (const name of ["a_padXZ", "a_padTone"]) {
    const { stride, offset, size } = pointerFor(gl, name);
    if (offset + size * 4 > stride) throw new Error(`${name} overlaps the next instance: ${offset}..${offset + size * 4} in stride ${stride}`);
  }
  for (const name of ["a_padXZ", "a_padTone"]) {
    if (gl.log.divisors.find((d) => d.attrib === name)?.divisor !== 1) {
      throw new Error(`${name} is not per-instance (divisor ${JSON.stringify(gl.log.divisors)})`);
    }
  }
});

test("boot_wiresTheRealPadFieldPadsOntoTheirOwnLayoutPositions", () => {
  const gl = recordingGL();
  const { api: page } = boot({ glFactory: () => gl });
  const instanceUpload = gl.log.uploads
    .filter((u) => u.where === "ARRAY_BUFFER")
    .reduce((best, u) => (u.data.length > best.data.length ? u : best));
  const layout = page.composeLayout();
  if (instanceUpload.data.length !== layout.instanceCount * 4) {
    throw new Error(`instance buffer holds ${instanceUpload.data.length} floats, want ${layout.instanceCount * 4}`);
  }

  const xzPointer = pointerFor(gl, "a_padXZ");
  const tonePointer = pointerFor(gl, "a_padTone");
  const lastBase = (layout.instanceCount - 1) * xzPointer.stride;
  for (const [name, pointer] of [["a_padXZ", xzPointer], ["a_padTone", tonePointer]]) {
    const reach = lastBase + pointer.offset + pointer.size * 4;
    if (reach > instanceUpload.buffer.byteLength) {
      throw new Error(`${name} reads ${reach} bytes, past the ${instanceUpload.buffer.byteLength}-byte instance buffer`);
    }
  }

  const decodedPads = (pointer) => decodeAttrib(instanceUpload, pointer, 3);
  near(decodedPads(xzPointer).flat(), layout.pads.slice(0, 3).flatMap((p) => [p.x, p.z]), "pad x/z must match the layout");
  near(decodedPads(tonePointer).flat(), layout.pads.slice(0, 3).flatMap((p) => [p.tone, p.phase]), "pad tone/phase must match the layout");
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
