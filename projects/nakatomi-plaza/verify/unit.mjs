// Unit tests for the Nakatomi Plaza show, run against the built page.
//
// The page is one inline module script. The harness extracts it, rewrites the
// single three.js import to a stub namespace, and runs it in a vm sandbox: no
// GL, no browser. A fragment that boots clean in this sandbox boots clean in
// the page.
//
// Usage: node verify/unit.mjs [name-filter]

import { readFileSync } from "node:fs";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
export const PAGE = resolve(ROOT, "index.html");

const SCRIPT_RE = /<script type="module">([\s\S]*?)<\/script>/;
const IMPORT_RE = /^import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["'];?[ \t]*$/m;

export function extractInlineModule(html) {
  const m = html.match(SCRIPT_RE);
  if (!m) throw new Error("index.html has no inline module script");
  return m[1];
}

// Rewrites the one three.js import into a lookup on the sandbox global, so the
// module body can run in vm without a loader. Returns null when there is no
// import - the fragments before Task 1's shell have none.
export function stubThreeImport(body) {
  const m = body.match(IMPORT_RE);
  if (!m) return null;
  return body.replace(m[0], `const ${m[1]} = __THREE__;`);
}

function el(tag = "div") {
  const e = {
    tagName: tag.toUpperCase(),
    style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    dataset: {},
    textContent: "",
    innerHTML: "",
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; },
    querySelectorAll() { return []; },
  };
  return e;
}

export function makeTHREEStub() {
  class V {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(o) { return this.set(o.x, o.y, o.z); }
    clone() { return new V(this.x, this.y, this.z); }
    add(o) { return this.set(this.x + o.x, this.y + o.y, this.z + o.z); }
    sub(o) { return this.set(this.x - o.x, this.y - o.y, this.z - o.z); }
    multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
    length() { return Math.hypot(this.x, this.y, this.z); }
    toArray() { return [this.x, this.y, this.z]; }
  }
  const meshStub = function (geometry, material, count) {
    this.geometry = geometry; this.material = material; this.count = count ?? 0;
    this.position = new V(); this.scale = new V(1, 1, 1); this.rotation = { x: 0, y: 0, z: 0 };
    this.visible = true; this.castShadow = false; this.receiveShadow = false;
    this.matrixAutoUpdate = true; this.children = [];
    this.instanceMatrix = { array: new Float32Array((count ?? 0) * 16) };
    this.instanceColor = null;
    this.setMatrixAt = (i, m) => { if (i * 16 + 16 > this.instanceMatrix.array.length) throw new Error(`setMatrixAt out of range: ${i}`); };
    this.setColorAt = () => {};
    this.add = (c) => { this.children.push(c); return c; };
    this.lookAt = () => {};
    this.updateMatrix = () => {};
    this.updateMatrixWorld = () => {};
    this.traverse = (fn) => fn(this);
  };
  const geo = function (w = 1, h = 1, d = 1) { this.parameters = { width: w, height: h, depth: d }; this.dispose = () => {}; };
  const mat = function (p = {}) { Object.assign(this, p); this.color = new V(); this.dispose = () => {}; };
  const T = {
    Vector3: V,
    BoxGeometry: geo, PlaneGeometry: geo, CircleGeometry: geo, CylinderGeometry: geo, ConeGeometry: geo,
    InstancedMesh: meshStub, Mesh: meshStub, Group: meshStub, Object3D: meshStub,
    PerspectiveCamera: function (fov = 50, near = 0.1, far = 1000) {
      this.position = new V(); this.up = new V(0, 1, 0); this.fov = fov; this.near = near; this.far = far;
      this.lookAt = () => {}; this.updateProjectionMatrix = () => {}; this.add = (c) => c;
    },
    Scene: function () { this.children = []; this.add = (c) => { this.children.push(c); return c; }; this.fog = null; this.background = null; },
    Color: function (c) { this.value = c ?? 0; this.set = (v) => { this.value = v; return this; }; this.setHex = (v) => { this.value = v; return this; }; },
    AmbientLight: meshStub, DirectionalLight: meshStub, HemisphereLight: meshStub, PointLight: meshStub, SpotLight: meshStub,
    Fog: function (c, n, f) { this.color = c; this.near = n; this.far = f; },
    FogExp2: function (c, d) { this.color = c; this.density = d; },
    MeshStandardMaterial: mat, MeshBasicMaterial: mat, MeshLambertMaterial: mat, MeshPhongMaterial: mat,
    Matrix4: function () { this.elements = new Array(16).fill(0); this.compose = () => this; this.identity = () => this; },
    MathUtils: { lerp: (a, b, t) => a + (b - a) * t, clamp: (v, a, b) => Math.min(Math.max(v, a), b), degToRad: (d) => (d * Math.PI) / 180, randFloat: (a, b) => a },
    SRGBColorSpace: "srgb", LinearSRGBColorSpace: "srgb-linear", NoColorSpace: "",
    NoToneMapping: 0, ACESFilmicToneMapping: 1, ReinhardToneMapping: 2,
    AdditiveBlending: 1, NormalBlending: 0, DoubleSide: 2, FrontSide: 0,
    WebGLRenderer: function () { this.domElement = el("canvas"); this.setSize = () => {}; this.setPixelRatio = () => {}; this.render = () => {}; this.setClearColor = () => {}; },
  };
  return T;
}

export function createSandbox() {
  const byId = new Map();
  const document = {
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, el("div")); return byId.get(id); },
    createElement: (t) => el(t),
    createTextNode: (t) => ({ textContent: t }),
    querySelectorAll: () => [],
    querySelector: () => el("div"),
    addEventListener() {}, body: el("body"), documentElement: el("html"),
    hidden: false, visibilityState: "visible",
  };
  const sandbox = {
    __THREE__: makeTHREEStub(),
    console,
    document,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener() {},
    devicePixelRatio: 1,
    innerWidth: 800, innerHeight: 600,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox, { name: "nakatomi-page" });
  return sandbox;
}

export function runModuleIn(sandbox, body) {
  new vm.Script(body, { filename: "index.html:module" }).runInContext(sandbox);
  return sandbox;
}

// Convenience for the tasks that follow: build, boot, and hand back the page's
// NAKATOMIC plus the sandbox it booted in.
export function boot() {
  const html = readFileSync(PAGE, "utf8");
  const body = stubThreeImport(extractInlineModule(html));
  if (body === null) throw new Error("index.html module has no three.js import - the shell fragment is missing it");
  const sandbox = createSandbox();
  runModuleIn(sandbox, body);
  const N = sandbox.window.NAKATOMIC;
  if (!N) throw new Error("module did not publish window.NAKATOMIC");
  return { N, sandbox };
}

export function build() {
  execFileSync(process.execPath, [resolve(ROOT, "scripts", "build.mjs")], { cwd: ROOT, stdio: "pipe" });
}

// --- test registry: describe(title, fn) / test(name, fn) -----------------
const suites = [];
let currentSuite = null;

export function describe(title, fn) {
  const suite = { title, cases: [] };
  currentSuite = suite;
  fn();
  currentSuite = null;
  suites.push(suite);
}

export function test(name, fn) {
  const suite = currentSuite || (suites.push({ title: "(root)", cases: [] }), suites[suites.length - 1]);
  suite.cases.push({ name, fn });
}

async function run(filter) {
  let pass = 0, fail = 0, skip = 0;
  for (const suite of suites) {
    const cases = suite.cases.filter((c) => !filter || c.name.includes(filter));
    if (!cases.length) { skip += suite.cases.length; continue; }
    console.log(`\n# ${suite.title}`);
    for (const c of cases) {
      try {
        await c.fn();
        pass++;
        console.log(`ok - ${c.name}`);
      } catch (e) {
        fail++;
        console.log(`not ok - ${c.name}`);
        console.log(`    ${(e && e.stack ? e.stack : String(e)).split("\n").slice(0, 6).join("\n    ")}`);
      }
    }
  }
  console.log(`\n1..${pass + fail}  pass ${pass}  fail ${fail}${skip ? `  (other suites filtered)` : ""}`);
  process.exitCode = fail ? 1 : 0;
}

// --- Task 1: the shell fragment boots in the sandbox ---------------------
describe("shell boots", () => {
  test("boot is clean", () => {
    build();
    const { N } = boot();
    assert.strictEqual(N.version, "0.1.0", "NAKATOMIC.version");
  });
});

// --- Task 2: the voxel run buffer and the palette gate -------------------
describe("voxel contract", () => {
  test("addRun merges +X into one run", () => {
    build();
    const { N } = boot();
    N.vox.reset();
    N.vox.addRun(0, 5, 0, 5, N.palette.id("#ff0000"));
    N.vox.addRun(3, 5, 0, 4, N.palette.id("#ff0000"));
    // union 0..7 = 7 voxels, counted once; two runs merged into one span.
    assert.strictEqual(N.vox.count, 7, "count after merge");
    const b = N.vox.bounds();
    assert.strictEqual(b.min.x, 0, "bounds min x");
    assert.strictEqual(b.max.x, 6, "bounds max x");
    assert.strictEqual(b.max.y, 5, "bounds max y");
    // the same run again must not double-count
    N.vox.addRun(0, 5, 0, 5, N.palette.id("#ff0000"));
    assert.strictEqual(N.vox.count, 7, "count after repeat add");
    // a different id on the same span is still separate
    N.vox.addRun(0, 5, 0, 5, N.palette.id("#00ff00"));
    assert.strictEqual(N.vox.count, 12, "count with second palette id on same span");
  });

  test("auto-allocated ids never enter the glass block", () => {
    build();
    const { N } = boot();
    // Fill the whole scene-owned range, then ask for one more colour: the
    // allocator must stop at the 0xd001 block boundary, not squat on glass ids.
    for (let id = 0x0100; id <= 0xd000; id++)
      N.palette.define(id, "#" + id.toString(16).padStart(6, "0"));
    assert.throws(() => N.palette.id("#ad1044"), /exhausted/, "allocator must stop below 0xd001");
    assert.strictEqual(N.palette.hexOf(0xd001), null, "glass block must stay unclaimed");
  });

  test("gate rejects reserved-range ids", () => {
    build();
    const { N } = boot();
    N.vox.reset();
    N.vox.addRun(1, 1, 1, 3, 0xe001);
    assert.throws(() => N.palette.gate(), /e001/, "gate must list the offender");
  });

  test("toSplats expands runs into points", async () => {
    build();
    const { toSplats } = await import(pathToFileURL(resolve(ROOT, "tools", "jsp.mjs")).href);
    const { N } = boot();
    N.vox.reset();
    N.vox.addRun(2, 0, 0, 3, N.palette.id("#0000ff"));
    const s = toSplats(N.vox.buffer());
    assert.strictEqual(s.points.length, 3, "splat points");
    assert.strictEqual(s.colors.length, 3, "splat colors");
    assert.deepStrictEqual(s.points[2], [4, 0, 0], "splat point order");
    assert.match(s.colors[0], /^#0000ff$/i, "splat color");
  });
});

// --- Task 3: tower core + the outside-envelope contract ------------------
describe("tower core", () => {
  test("tower is solid and bounded", () => {
    build();
    const { N } = boot();
    assert.strictEqual(N.tower.built, true, "tower.built");
    assert.strictEqual(N.tower.height, 46, "roof deck sits at y=46");
    const b = N.vox.bounds();
    assert.ok(Number.isFinite(b.min.x) && b.min.x <= b.max.x, "bounds are finite");
    // Every voxel the buffer holds sits inside bounds() - the definition of a
    // bounded build, and the reason the render can size one InstancedMesh.
    for (const r of N.vox.runs()) {
      assert.ok(r.x >= b.min.x && r.x + r.len - 1 <= b.max.x, `run x ${r.x}+${r.len} out of bounds`);
      assert.ok(r.y >= b.min.y && r.y <= b.max.y, `run y ${r.y} out of bounds`);
      assert.ok(r.z >= b.min.z && r.z <= b.max.z, `run z ${r.z} out of bounds`);
    }
    // The shaft reads solid: a storey band on each face at mid-height, and the
    // shaft resting on the podium deck.
    const runs = N.vox.runs();
    const has = (x, y, z) => runs.some((r) => r.x <= x && x < r.x + r.len && r.y === y && r.z === z);
    assert.ok(has(12, 10, 0), "glass line voxel on the +x face, lower shaft");
    assert.ok(has(-12, 10, 0), "glass line voxel on the -x face, lower shaft");
    assert.ok(has(0, 10, 12), "glass line voxel on the +z face, lower shaft");
    assert.ok(has(0, 4, -12), "shaft rests on the podium deck at y=4");
    assert.ok(has(0, 46, 0), "roof deck is built");
  });

  test("envelope encloses the glass line", () => {
    build();
    const { N } = boot();
    const e = N.envelope;
    // Field-by-field: objects created inside the vm sandbox carry that context's
    // prototype, so deepStrictEqual across realms would fail on identity, not data.
    for (const [k, v] of Object.entries({ x: -22, y: 0, z: -19 }))
      assert.strictEqual(e.min[k], v, `envelope.min.${k}`);
    for (const [k, v] of Object.entries({ x: 22, y: 46, z: 19 }))
      assert.strictEqual(e.max[k], v, `envelope.max.${k}`);
    // A glass-line corner is NOT outside.
    assert.strictEqual(e.isOutside({ x: 12, y: 5, z: 12 }), false, "glass corner is inside");
    // 4 m beyond that corner is outside: the envelope clears the glass line by 2 m
    // at every band, so the shell hugs the building instead of the podium box.
    assert.strictEqual(e.isOutside({ x: 16, y: 5, z: 16 }), true, "4 m beyond is outside");
    assert.strictEqual(e.isOutside({ x: 15, y: 10, z: 0 }), true, "just past the shaft skirt");
    assert.strictEqual(e.isOutside({ x: 13, y: 10, z: 0 }), false, "just inside the shaft skirt");
    // The podium skirt, at plaza level: 2 m clear of the podium wall.
    assert.strictEqual(e.isOutside({ x: 21, y: 1, z: 0 }), false, "skirt hugs the podium");
    assert.strictEqual(e.isOutside({ x: 23, y: 1, z: 0 }), true, "just past the podium skirt");
    // R12/13: over the roof deck is outside by definition, even above the
    // penthouse footprint.
    assert.strictEqual(e.isOutside({ x: 0, y: 47, z: 0 }), true, "above the deck is outside");
    assert.strictEqual(e.isOutside({ x: 0, y: -1, z: 0 }), true, "below street level is outside");
    // radius frames the whole envelope: it reaches every corner.
    const cx = (e.min.x + e.max.x) / 2, cy = (e.min.y + e.max.y) / 2, cz = (e.min.z + e.max.z) / 2;
    for (const y of [e.min.y, e.max.y])
      for (const x of [e.min.x, e.max.x])
        for (const z of [e.min.z, e.max.z])
          assert.ok(e.radius >= Math.hypot(x - cx, y - cy, z - cz) - 1e-9, "radius covers corner");
  });
});

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await run(process.argv[2] || null);
}
