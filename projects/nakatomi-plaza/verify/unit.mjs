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
  const geo = function (w = 1, h = 1, d = 1) { this.parameters = { width: w, height: h, depth: d }; this.dispose = () => {}; this.attributes = {}; this.setAttribute = (n, a) => { this.attributes[n] = a; }; this.setDrawRange = () => {}; };
  const mat = function (p = {}) { Object.assign(this, p); this.color = new V(); this.dispose = () => {}; };
  const attr = function (array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; };
  const T = {
    Vector3: V, Vector2: function (x = 0, y = 0) { this.x = x; this.y = y; this.set = (a, b) => { this.x = a; this.y = b; return this; }; },
    BufferGeometry: geo, BufferAttribute: attr, Float32BufferAttribute: attr, Points: meshStub, PointsMaterial: mat,
    BoxGeometry: geo, PlaneGeometry: geo, CircleGeometry: geo, CylinderGeometry: geo, ConeGeometry: geo,
    InstancedMesh: meshStub, Mesh: meshStub, Group: meshStub, Object3D: meshStub,
    PerspectiveCamera: function (fov = 50, near = 0.1, far = 1000) {
      this.position = new V(); this.up = new V(0, 1, 0); this.fov = fov; this.near = near; this.far = far;
      this.lookAt = () => {}; this.updateProjectionMatrix = () => {}; this.add = (c) => c;
    },
    Scene: function () { this.children = []; this.add = (c) => { this.children.push(c); return c; }; this.remove = (c) => { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }; this.fog = null; this.background = null; },
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
    // Unclaimed block ids stay empty: only an explicit define() may put a colour
    // in 0xd001..0xdfff, and whatever is pinned there must map back to its hex.
    assert.strictEqual(N.palette.hexOf(0xdfff), null, "unclaimed block id stays null");
    for (const [id, hex] of N.palette.entries)
      if (id >= 0xd001 && id <= 0xdfff)
        assert.strictEqual(N.palette.id(hex), id, `block id 0x${id.toString(16)} must be pinned by hex`);
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

// --- Task 5: the ground contract ----------------------------------------
describe("ground contract", () => {
  test("ground() shape and locked numbers", () => {
    build();
    const { N } = boot();
    const g = N.ground();
    const keys = "voxels batchVox countVox bounds garageVolume ditchVolume plazaVolume waterVolume palmCount skylineCount streetY".split(" ");
    assert.deepStrictEqual(Object.keys(g).sort(), keys.slice().sort(), "ground() returns exactly the v1 keys");
    // The two numbers v1 verified, locked as the invariant.
    assert.strictEqual(g.countVox, 9406, "countVox is the locked ground batch size");
    assert.strictEqual(g.skylineCount, 2860, "skylineCount is locked");
    assert.ok(g.skylineCount / g.countVox > 0.3 && g.skylineCount / g.countVox < 0.31,
      "skyline is 30.4 % of the ground batch");
    assert.ok(g.batchVox > 0 && g.batchVox < g.countVox, "batchVox counts runs, fewer than voxels");
    assert.ok(g.garageVolume > 0 && g.ditchVolume > 0 && g.plazaVolume > 0, "sunken volumes are positive");
    assert.ok(g.waterVolume > 0, "the fountain has water in it");
    assert.strictEqual(g.palmCount, 12, "palm grove");
    assert.strictEqual(g.streetY, 0, "street level");
    const b = g.bounds;
    assert.ok(b.min.y <= -6, "the garage lot sits below street level");
    assert.ok(b.max.y >= 0, "the bridge deck reaches street level");
    // isOnGround: inside the lot, false beyond the boulevard.
    assert.strictEqual(N.isOnGround(0, 0), true, "the plaza is ground");
    assert.strictEqual(N.isOnGround(0, -25), true, "the front boulevard is ground");
    assert.strictEqual(N.isOnGround(-43, -31), true, "the plaza corner is ground");
    assert.strictEqual(N.isOnGround(44, 0), false, "past the boulevard edge is not");
    assert.strictEqual(N.isOnGround(0, -32), false, "past the block edge is not");
  });

  test("skyline splices are full width", () => {
    build();
    const { N } = boot();
    N.ground();
    const skyIds = new Set(Object.values(N.skyline.ids));
    const runs = N.vox.runs().filter((r) => skyIds.has(r.id));
    assert.ok(runs.length > 0, "the skyline is in the buffer");
    const width = runs[0].len;
    for (const r of runs) {
      assert.strictEqual(r.len, width, `splice at ${r.x},${r.y},${r.z} is not full width (${r.len} vs ${width})`);
      assert.strictEqual(r.x, N.skyline.x0, "every splice starts at the skyline west edge");
    }
    assert.strictEqual(width, 110, "the skyline band is 110 columns wide");
    // Full width means no gap column: the union of a row covers every column.
    const rows = new Map();
    for (const r of runs) {
      const k = `${r.z}|${r.y}`;
      rows.set(k, (rows.get(k) || 0) + r.len);
    }
    for (const [k, n] of rows) assert.strictEqual(n, 110, `skyline row ${k} has gaps`);
  });
});

// --- Task 6: the show clock ---------------------------------------------
describe("show clock", () => {
  // Appendix A, verbatim. One joined string, so the whole table is one compare:
  // the sandbox's arrays carry the sandbox prototype, so per-element deep compares
  // are not usable here.
  const TABLE = [
    ["open", "Dusk over the boulevard - establishing", 34, 0],
    ["taxiConvoy", "Taxi convoy onto the lot", 38, 34],
    ["horseCar", "Horse car and motorcycle escort", 33, 72],
    ["limoNakatomi", "Nakatomi Plaza signage, glass lobby", 38, 105],
    ["treeTruck", "Christmas tree truck, light trucks", 36, 143],
    ["archWalk", "Walkway, palms, marquee", 35, 179],
    ["treeSet", "Tree set down beneath the glass", 34, 214],
    ["skateHolly", "Holly on skates to the doors", 32, 248],
    ["gunRun", "Gun run staged on the roof", 38, 280],
    ["tileHelo", "Tile helo - the whomp", 42, 318],
    ["blast", "Blast - first facade break (starts at 360)", 30, 360],
    ["storm", "Storm over the skyline (dur 95)", 95, 390],
    ["fedConvoy", "Fed convoys up the boulevard", 42, 485],
    ["wallOfCars", "Wall of police cars on the lot", 36, 527],
    ["lobbyLights", "Lobby lights hold under dusk", 34, 563],
    ["carDepart", "Cars off the lot at dusk pull-back", 22, 597],
    ["treeGlow", "Tree glow, canopy shimmer", 18, 619],
    ["fountainSettle", "Fountain settles, water still", 15, 637],
    ["plazaWide", "Plaza wide, empty walkway", 13, 652],
    ["skyPush1", "Skyline push-in 1", 11, 665],
    ["skyPush2", "Skyline push-in 2", 10, 676],
    ["towerPull", "Tower pull-back to boulevard", 9, 686],
    ["rooftopGlow", "Rooftop glow, penthouse lights", 8, 695],
    ["drestle", "Final settling frame before the hold", 12, 703],
  ].map(([id, label, dur, start]) => `${id}|${label}|${dur}|${start}`).join(";");

  test("BEATS literal equals the Beat Table", () => {
    build();
    const { N } = boot();
    const got = N.clock.BEATS.map((b) => `${b.id}|${b.label}|${b.dur}|${N.clock.start(b.id)}`).join(";");
    assert.strictEqual(got, TABLE, "BEATS is the 24 rows of Appendix A, in order");
    assert.strictEqual(N.clock.order.length, 24, "order holds 24 ids");
    assert.strictEqual(N.clock.order.map((s) => s).join(","),
      N.clock.BEATS.map((b) => b.id).join(","), "order matches BEATS");
    // cumulative starts are pinned by the table, and storm/blast are the v1 anchors
    assert.strictEqual(N.clock.start("storm"), 390, "storm starts at 390");
    assert.strictEqual(N.clock.start("blast"), 360, "blast starts at 360");
  });

  test("clock constants", () => {
    build();
    const { N } = boot();
    const c = N.clock;
    const sum = c.BEATS.reduce((a, b) => a + b.dur, 0);
    assert.strictEqual(sum, 715, "durations sum to 715");
    assert.strictEqual(c.len, 715, "len");
    assert.strictEqual(c.BEAT_END, 715, "BEAT_END");
    assert.strictEqual(c.HOLD, 20, "HOLD");
    assert.strictEqual(c.SHOW_LEN, 735, "SHOW_LEN = BEAT_END + HOLD");
    assert.strictEqual(c.FADE_LEN, 6, "FADE_LEN");
    assert.strictEqual(c.FADE_START, 729, "FADE_START = SHOW_LEN - FADE_LEN");
    assert.strictEqual(c.dur("storm"), 95, "storm absorbs the slack at 95");
    assert.strictEqual(c.seekTo("blast"), 360, "seekTo(blast) is the locked v1 invariant");
  });

  test("hold and fade and wrap", () => {
    build();
    const { N } = boot();
    const c = N.clock;
    // the hold window is still on screen but no longer has a beat label
    assert.strictEqual(c.beatAt(715), null, "beatAt is null at BEAT_END");
    assert.strictEqual(c.beatAt(730), null, "beatAt is null in the hold");
    assert.strictEqual(c.beatAt(734.99), null, "still null just before the cut");
    assert.strictEqual(c.beatAt(703).id, "drestle", "the last beat runs up to BEAT_END");
    assert.strictEqual(c.beatAt(360).id, "blast", "beatAt at a beat's start");
    assert.strictEqual(c.beatAt(359.99).id, "tileHelo", "beatAt at a beat's end");
    // the fade must reach full black while the frame is still showing
    c.seekTo("drestle");
    let blacked = null, wrapped = false;
    for (let i = 0; i < 400 && blacked === null; i++) {
      const r = c.tick(c.dtClamp);
      if (r.wrapped) wrapped = true;
      if (c.fade.black === 1) blacked = c.t;
    }
    assert.notStrictEqual(blacked, null, "fade.black hits 1");
    assert.ok(!wrapped, "full black comes before the wrap");
    assert.ok(blacked < c.SHOW_LEN, `full black (${blacked}) must happen before the cut at ${c.SHOW_LEN}`);
    // one-clamp grace: the wrap waits a frame past SHOW_LEN, then resets exactly once
    assert.strictEqual(c.wrapAt, c.SHOW_LEN + c.dtClamp, "wrapAt is SHOW_LEN plus one clamped frame");
    for (let i = 0; i < 40 && !wrapped; i++) wrapped = !!c.tick(c.dtClamp).wrapped;
    assert.strictEqual(c.t, 0, "the clock resets to 0 exactly once");
    c.tick(c.dtClamp);
    assert.strictEqual(c.t, c.dtClamp, "the frame after the wrap continues from 0, no leftover");
    // and dt is clamped once: a long gap (a returned tab) can not skip the show
    const before = c.t;
    c.tick(9e4);
    assert.strictEqual(c.t, before + c.dtClamp, "dt is clamped once, not twice");
  });

  test("fade observable at FADE_START", () => {
    build();
    const { N } = boot();
    const c = N.clock;
    c.seekTo("skyPush2");
    assert.strictEqual(c.fade.black, 0, "no fade before FADE_START");
    let r;
    for (let guard = 0; c.t < c.FADE_START && guard < 1000; guard++) r = c.tick(c.dtClamp);
    assert.strictEqual(c.t, c.FADE_START, "frames land exactly on FADE_START");
    assert.ok(c.fade.black > 0, "the fade is visible on the very frame FADE_START renders");
    assert.ok(c.fade.black < 1, "and still short of black at its start");
    assert.ok(r && typeof r.black === "number", "tick reports the black value to the render loop");
  });
});

// --- Task 4: curtain wall + the dusk lit rule ---------------------------
describe("curtain wall", () => {
  // The perimeter ring of a band, cell by cell, corners once.
  const ringCells = (f, y0, y1) => {
    const out = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = f.x0; x <= f.x1; x++) out.push([x, y, f.z0], [x, y, f.z1]);
      for (let z = f.z0 + 1; z <= f.z1 - 1; z++) out.push([f.x0, y, z], [f.x1, y, z]);
    }
    return out;
  };

  const cellKeysOf = (N) => {
    const seen = new Map();
    for (const r of N.vox.runs())
      for (let i = 0; i < r.len; i++) {
        const k = `${r.x + i}|${r.y}|${r.z}`;
        seen.set(k, (seen.get(k) || []).concat(r.id));
      }
    return seen;
  };

  test("glass ids sit in the 0xd001 block, none reserved", () => {
    build();
    const { N } = boot();
    assert.ok(N.glass.cells.length > 500, "the shaft is glazed");
    for (const name of ["lit", "dark", "shatter"]) {
      const id = N.glass.ids[name];
      assert.ok(id >= 0xd001 && id <= 0xdfff, `glass id ${name} = 0x${id.toString(16)} not in the 0xd001 block`);
    }
    // Every glass cell the buffer holds carries one of the block ids, and the
    // gate stays clean with the glass in it.
    const ids = Object.values(N.glass.ids);
    for (const c of N.glass.cells) assert.ok(ids.includes(c.id), `cell id 0x${c.id.toString(16)} not a glass id`);
    assert.strictEqual(N.palette.gate(), true, "the palette gate must stay clean");
  });

  test("mullion density - the wall covers every facade cell, once", () => {
    build();
    const { N } = boot();
    // No cell claimed by two different ids: voxel total equals distinct cells.
    const claims = cellKeysOf(N);
    assert.strictEqual(claims.size, N.vox.count, "a voxel is drawn twice at the same cell");
    for (const [k, list] of claims)
      assert.strictEqual(new Set(list).size, 1, `cell ${k} claimed by ${list.length} ids`);

    // Every facade cell of every band is claimed by the curtain wall or the
    // structure: no holes in the envelope of the tower.
    const s = N.tower.sections;
    for (const f of [s.podium, s.lower, s.setback, s.upper]) {
      const hi = f === s.podium ? f.y1 - 1 : f.y1;    // the podium deck row is a slab
      for (const [x, y, z] of ringCells(f, f.y0, hi))
        assert.ok(claims.has(`${x}|${y}|${z}`), `facade cell ${x},${y},${z} is empty`);
    }

    // The glaze is most of the wall; the mullion frame is the rest. Coverage is
    // measured over the facade ring, and the brief pins it at 0.55..0.75.
    const facade = new Set();
    for (const f of [s.podium, s.lower, s.setback, s.upper]) {
      const hi = f === s.podium ? f.y1 - 1 : f.y1;
      for (const [x, y, z] of ringCells(f, f.y0, hi)) facade.add(`${x}|${y}|${z}`);
    }
    assert.ok(facade.size > 4000, `facade ring is ${facade.size} cells`);
    const share = N.glass.cells.length / facade.size;
    assert.ok(share > 0.55 && share < 0.75, `glazing share ${share.toFixed(3)} outside 0.55..0.75`);
    assert.strictEqual(N.glass.litFraction, share, "litFraction is the glazing coverage share");
    assert.strictEqual(N.glass.facadeCells, facade.size, "facadeCells is the ring the wall covers");
  });

  test("lit cells follow the dusk rule - most dark, lobby bright", () => {
    build();
    const { N } = boot();
    const lit = N.glass.cells.filter((c) => c.lit);
    const share = lit.length / N.glass.cells.length;
    assert.ok(share > 0.15 && share < 0.4, `lit share ${share.toFixed(3)} of the glaze is not "most dark"`);
    assert.strictEqual(N.glass.litShare, share, "litShare is the dusk rule's lit fraction");

    // Lobby bright: every podium arcade cell and the atrium bands glow warm.
    const lobby = N.glass.cells.filter((c) => c.y <= 2 && c.z === -17);
    assert.ok(lobby.length > 20 && lobby.every((c) => c.lit), "podium lobby glow");
    const atrium = N.glass.cells.filter((c) => c.y >= 4 && c.y <= 9 && c.z === -12);
    assert.ok(atrium.length > 20 && atrium.every((c) => c.lit), "atrium glow");
    assert.ok(atrium.every((c) => N.glass.lit(c.id)), "lit(id) marks the glow ids");
    assert.ok(!N.glass.lit(N.glass.ids.dark), "lit(dark glass id) is false");

    // And the upper shaft is dark at dusk - the finale floors are the exception.
    for (const y of [16, 17, 18, 19, 20, 21, 24, 30, 34]) {
      const row = N.glass.cells.filter((c) => c.y === y);
      assert.ok(row.length > 0, `band ${y} has glazing`);
      assert.ok(row.filter((c) => c.lit).length / row.length < 0.3, `band ${y} should read dark`);
    }
  });
});

// --- Task 7.5: scene assembly - first pixels (R18 pulled forward) --------
describe("scene assembly", () => {
  test("ground() caches its batch, so a second call re-emits nothing", () => {
    build();
    const { N } = boot();
    // The shared buffer coalesces by palette id, so a second emit would not double
    // vox.count - it would just redo 9406 cells of work on every frame the render
    // loop takes. The gate pins the caching instead: no emissions, same object.
    const orig = N.vox.addRun;
    let emissions = 0;
    N.vox.addRun = (...a) => { emissions++; return orig(...a); };
    const first = N.ground();
    assert.ok(emissions > 0, "the first call emits the batch");
    const runs = N.vox.runs().length, voxCount = N.vox.count;
    emissions = 0;
    const second = N.ground();
    N.vox.addRun = orig;
    assert.strictEqual(emissions, 0, "the second call must not re-emit into the shared buffer");
    assert.strictEqual(second, first, "the cached batch is the same object");
    assert.strictEqual(N.vox.runs().length, runs, "run count unchanged");
    assert.strictEqual(N.vox.count, voxCount, "voxel count unchanged");
    assert.strictEqual(first.countVox, 9406, "the locked ground number still holds");
  });

  test("ensureWorld puts the whole plaza, not just the tower, in the buffer", () => {
    build();
    const { N } = boot();
    const world = N.ensureWorld();
    assert.strictEqual(world, N.ensureWorld(), "the world is built exactly once");
    assert.ok(world.ground && world.buffer && world.bounds, "the world carries ground + buffer + bounds");
    // The shared buffer is what render builds from, so it must span the ground
    // contract's own extents: garage floor band, block edge, skyline edge, roof deck.
    const b = N.vox.bounds();
    const p = N._plan, sky = N.skyline;
    assert.ok(b.min.y <= p.LOT, `buffer floor ${b.min.y} is not as low as the lot band ${p.LOT}`);
    assert.ok(b.min.x <= sky.x0 && b.max.x >= sky.x1, "the skyline span is not in the buffer");
    assert.ok(b.min.z <= p.BLOCK.z0, "the block's near edge is not in the buffer");
    assert.ok(b.max.z >= Math.max(...sky.walls.map((w) => w.z)), "the far skyline wall is not in the buffer");
    assert.ok(b.max.y >= N.tower.roofDeck, "the roof deck is not in the buffer");
    assert.strictEqual(world.voxels, N.vox.count, "the world's voxel total is the buffer's");
    assert.ok(world.voxels > 9406 + N.glass.cells.length, "the world holds ground + tower + glass");
  });

  test("splats() mirrors tools/jsp.mjs, one point per voxel", async () => {
    build();
    const { toSplats } = await import(pathToFileURL(resolve(ROOT, "tools", "jsp.mjs")).href);
    const { N } = boot();
    N.ensureWorld();
    const view = N.vox.buffer();
    const a = N.splats(view), b = toSplats(view);
    assert.strictEqual(a.points.length, b.points.length, "point count matches the Node tool");
    assert.strictEqual(a.colors.length, b.colors.length, "colour count matches the Node tool");
    assert.strictEqual(a.points.length, N.vox.count, "one splat per voxel");
    // Element-wise on primitives: the page-side arrays come from the vm sandbox,
    // and deepStrictEqual compares prototypes, which differ across realms.
    const keyOf = (s) => s.points.map((p) => p.join(",")).join(";");
    assert.strictEqual(keyOf(a), keyOf(b), "splat positions match the Node tool, in order");
    assert.strictEqual(a.colors.join(","), b.colors.join(","), "splat colours match the Node tool, in order");
    for (const hex of a.colors) assert.match(hex, /^#[0-9a-f]{6}$/i, "splat colour is a hex");
    assert.ok(a.colors.includes(N.palette.hexOf(N.glass.ids.lit)), "lit glass reaches the splats");
  });

  test("palette hexes reach the renderer as 0..1 channels, not raw 0-255 bytes", () => {
    build();
    const { N } = boot();
    // The first live frames came back white: srgbToLinear was handed the raw byte
    // instead of the channel, so pow((107 + 0.055)/1.055, 2.4) = 65,350 for the
    // mid-greys and every channel clamped to 1 in the shader. The gate pins the
    // range for the whole palette, so the bug can never come back silently.
    for (const [id, hex] of N.palette.entries) {
      const c = N.colorLinear(hex);
      assert.strictEqual(c.length, 3, `${hex} has three channels`);
      for (const v of c) {
        assert.ok(Number.isFinite(v), `channel for ${hex} (id 0x${id.toString(16)}) is finite`);
        assert.ok(v >= 0 && v <= 1, `channel ${v} for ${hex} is outside the 0..1 render range`);
      }
    }
    // The ends of the ramp: white stays white, black stays black.
    assert.strictEqual(N.colorLinear("#ffffff").join(","), "1,1,1", "white");
    assert.strictEqual(N.colorLinear("#000000").join(","), "0,0,0", "black");
    // And the lit glass, in working-space linear: #ffcc77 is a full red, an amber
    // green and a dim blue. The exact numbers are what the framebuffer must read.
    const lit = N.colorLinear(N.palette.hexOf(N.glass.ids.lit));
    const near = (got, want) => Math.abs(got - want) < 5e-4;
    assert.ok(near(lit[0], 1), `lit red channel ${lit[0]}`);
    assert.ok(near(lit[1], 0.60388), `lit green channel ${lit[1]}`);
    assert.ok(near(lit[2], 0.18452), `lit blue channel ${lit[2]}`);
  });

  test("the scene exposes its contract and boots without GL", () => {
    build();
    const { N } = boot();
    const keys = "camera cameraSource domElement follow fov framing gl label paused rebuild restart running setFraming setPose start stats step togglePause".split(" ").sort();
    assert.deepStrictEqual(Object.keys(N.scene).sort(), keys, "scene keys are pinned");
    for (const k of ["start", "rebuild", "setFraming", "setPose", "step", "label", "togglePause", "restart"])
      assert.strictEqual(typeof N.scene[k], "function", `scene.${k} is a function`);
    assert.strictEqual(N.scene.running, false, "the loop is not running until start()");
    assert.strictEqual(N.scene.gl, null, "no renderer before start()");
    // fx joins the pinned shape in Task 10: the overlay's per-frame count is part of
    // the rig's public stats, which is how the live driver proves the burst painted.
    assert.deepStrictEqual(Object.keys(N.scene.stats).sort(), "fps fx points voxels".split(" ").sort(), "stats keys");
    // The hold fallback needs no beat label to exist: label() answers for the hold.
    assert.strictEqual(N.scene.label({ t: 360, beat: N.clock.beatAt(360) }), N.clock.beatAt(360).label, "beat label");
  });

  test("the HUD says which camera painted the frame", () => {
    build();
    const { N } = boot();
    // The review screenshots beside the pixel bars have to say what they show, so
    // the rig knows which of its three cameras painted the frame it is describing:
    // one of the four fixed framings, a lens a tool pinned, or the take's own keys.
    N.scene.setPose({ pos: { x: 20, y: 5, z: 20 }, target: { x: 0, y: 5, z: 0 }, fov: 45 });
    assert.strictEqual(N.scene.cameraSource, "lens", "a pose a tool pins is that tool's lens");
    N.scene.setFraming(2);
    assert.strictEqual(N.scene.cameraSource, "framing", "setFraming names the tool's wide shot");
    // Only the loop's own step() may claim the take, and only with a beat to key:
    // that is the difference between the show's framing and a pinned pose, and it is
    // the label the live driver asserts for every beat's first painted frame.
    N.clock.seekTo("open");
    N.scene.step(N.clock.dtClamp);
    assert.strictEqual(N.scene.cameraSource, "take", "the take's keys painted that frame");
  });
});

// --- Task 7: the lobby, the fountain and the Christmas tree --------------
// These stand behind the glass line, so the one thing every test checks is that
// the camera's own contract agrees with them: the tree is NOT a point the
// envelope allows (envelope.isOutside is false), the glow is glass the camera
// sees from outside, and the fountain never re-claims the pool's water.
describe("lobby, fountain, tree", () => {
  test("the Christmas tree stands inside the glass line, on ground", () => {
    build();
    const { N } = boot();
    const lobby = N.lobbyWorld();
    const g = N.ground();
    const P = N.tower.sections.podium;
    assert.ok(lobby.treeCells.length > 0, "the tree is a volume, not one cell");
    const e = N.envelope;
    for (const c of lobby.treeCells) {
      // The brief's own wording: a tree voxel is NOT outside the envelope. If it
      // were, the camera would be allowed to sit inside the tree.
      assert.strictEqual(e.isOutside({ x: c.x, y: c.y, z: c.z }), false,
        `tree cell ${c.x},${c.y},${c.z} is outside the envelope`);
      assert.ok(c.y >= g.streetY, `tree cell ${c.x},${c.y},${c.z} is not on the ground band`);
      assert.ok(c.x >= P.x0 && c.x <= P.x1 && c.z >= P.z0 && c.z <= P.z1,
        `tree cell ${c.x},${c.y},${c.z} is outside the podium footprint`);
    }
    // Standing on the street band, and under the lobby deck - the podium's top row
    // is a concrete slab, so a tree that reached it would claim a tower cell.
    assert.strictEqual(lobby.treeMinY, g.streetY, "the tree's base is on the ground band");
    assert.ok(lobby.treeTopY <= P.y1 - 1, `tree top ${lobby.treeTopY} reaches the podium deck at ${P.y1}`);
    // The tree tapers: every band is no wider than the one under it.
    const bands = new Map();
    for (const c of lobby.treeCells) bands.set(c.y, (bands.get(c.y) || 0) + 1);
    const widths = [...bands.keys()].sort((a, b) => a - b).map((y) => bands.get(y));
    assert.ok(widths.every((w, i) => i === 0 || w <= widths[i - 1]), `tree bands do not taper: ${widths.join("/")}`);
  });

  test("the lobby glow is glass, seen from outside, but not the glass line itself", () => {
    build();
    const { N } = boot();
    const lobby = N.lobbyWorld();
    assert.ok(lobby.glowCells.length > 0, "the lobby interior glows");
    const glassPlane = new Set(N.glass.cells.map((c) => `${c.x},${c.y},${c.z}`));
    for (const c of lobby.glowCells) {
      assert.strictEqual(N.glass.lit(c.id), true, `glow cell ${c.x},${c.y},${c.z} is not a lit glass id`);
      assert.strictEqual(glassPlane.has(`${c.x},${c.y},${c.z}`), false,
        `glow cell ${c.x},${c.y},${c.z} sits on the glass line itself`);
      assert.strictEqual(N.envelope.isOutside({ x: c.x, y: c.y, z: c.z }), false,
        `glow cell ${c.x},${c.y},${c.z} is outside the envelope`);
    }
  });

  test("the fountain's water is the ground contract's water", () => {
    build();
    const { N } = boot();
    const lobby = N.lobbyWorld();
    const g = N.ground();
    const pool = N._plan.POOL;
    assert.strictEqual(lobby.waterCells, g.waterVolume,
      `the fountain counts ${lobby.waterCells} water voxels, the ground contract is ${g.waterVolume}`);
    // Same footprint, read as a join so the sandbox prototype never enters the way.
    const cells = new Set();
    for (let x = pool.x0; x <= pool.x1; x++)
      for (let z = pool.z0; z <= pool.z1; z++) cells.add(`${x},${z}`);
    assert.strictEqual(lobby.waterFootprint.slice().sort().join("|"),
      [...cells].sort().join("|"), "the fountain basin is the pool the ground carved");
  });

  test("the fountain stands above the water line, and never re-claims it", () => {
    build();
    const { N } = boot();
    const lobby = N.lobbyWorld();
    const pool = N._plan.POOL;
    const street = N._plan.STREET;
    assert.ok(lobby.fountainCells.length > 0, "the fountain has a volume above the water");
    const water = new Set();
    for (let x = pool.x0; x <= pool.x1; x++)
      for (let z = pool.z0; z <= pool.z1; z++) water.add(`${x},${z}`);
    for (const c of lobby.fountainCells) {
      assert.ok(c.y > street, `fountain cell ${c.x},${c.y},${c.z} is at or below the water line`);
      assert.strictEqual(water.has(`${c.x},${c.z}`), true,
        `fountain cell ${c.x},${c.y},${c.z} is outside the basin it should stand in`);
    }
    // The water itself belongs to the ground batch: this fragment emits none of it.
    // The water id is read straight out of that batch, so the check can't drift
    // from whichever hex the ground happens to pave the basin with.
    const g = N.ground();
    const waterId = g.voxels.find((r) => r.y === street && water.has(`${r.x},${r.z}`)).id;
    for (const c of lobby.fountainCells)
      assert.notStrictEqual(c.id, waterId,
        `fountain cell ${c.x},${c.y},${c.z} re-claims water`);
    assert.ok(new Set(lobby.fountainCells.map((c) => c.id)).size > 0,
      "the fountain structure has its own material");
  });

  test("the lobby batch claims each cell exactly once", () => {
    build();
    const { N } = boot();
    const lobby = N.lobbyWorld();
    const parts = lobby.floorCount + lobby.glowCount + lobby.treeCount +
      lobby.lightsCount + lobby.starCount + lobby.fountainCount;
    assert.strictEqual(lobby.countVox, parts,
      `occupancy holds ${lobby.countVox} cells but the parts add up to ${parts} - a cell is claimed twice`);
    // Idempotent, like ground(): a rebuild must not push the batch through addRun again.
    let emissions = 0;
    const orig = N.vox.addRun;
    N.vox.addRun = (...a) => { emissions++; return orig(...a); };
    const runs = N.vox.runs().length, voxCount = N.vox.count;
    const second = N.lobbyWorld();
    N.vox.addRun = orig;
    assert.strictEqual(emissions, 0, "the second call must not re-emit into the shared buffer");
    assert.strictEqual(second, lobby, "the cached batch is the same object");
    assert.strictEqual(N.vox.runs().length, runs, "run count unchanged");
    assert.strictEqual(N.vox.count, voxCount, "voxel count unchanged");
  });
});

// --- Task 8: plaza dressings ----------------------------------------------
// The dressings are the mirror image of Task 7: the lobby stuff lives *inside* the
// envelope and the camera sees it through glass, but everything in this batch lives
// *outside* it, on the street, because it is a thing the camera may sit beside.
// Two rules from the plan: every dressing volume is on ground and not inside the
// envelope; and the arrival lanes must not collide with the palm grove.
describe("plaza dressing", () => {
  // Sandbox arrays carry the sandbox prototype, so pull plain values out by index
  // before iterating them in host code.
  const palmColumns = (N) => N._plan.PALMS.map((p) => [p[0], p[1]]);

  test("every dressing volume stands on the ground, outside the envelope, and never re-claims one", () => {
    build();
    const { N } = boot();
    const dressing = N.plazaDressing();
    const g = N.ground();
    const street = N._plan.STREET;
    const all = dressing.vehicleCells
      .concat(dressing.marqueeCells, dressing.lightCells);
    assert.ok(all.length > 0, "the plaza has dressings at all");
    // The ground batch as a cell set, expanded from its runs.
    const groundCells = new Set();
    for (let i = 0; i < g.voxels.length; i++) {
      const r = g.voxels[i];
      for (let k = 0; k < r.len; k++) groundCells.add(`${r.x + k}|${r.y}|${r.z}`);
    }
    const glassPlane = new Set(N.glass.cells.map((c) => `${c.x},${c.y},${c.z}`));
    for (const c of all) {
      assert.strictEqual(N.envelope.isOutside({ x: c.x, y: c.y, z: c.z }), true,
        `dressing cell ${c.x},${c.y},${c.z} is not outside the envelope - the camera could not sit clear of it`);
      assert.strictEqual(N.isOnGround(c.x, c.z), true,
        `dressing cell ${c.x},${c.y},${c.z} is off the block`);
      assert.ok(c.y >= street, `dressing cell ${c.x},${c.y},${c.z} is below the street band`);
      assert.strictEqual(groundCells.has(`${c.x},${c.y},${c.z}`), false,
        `dressing cell ${c.x},${c.y},${c.z} re-claims a ground cell`);
      assert.strictEqual(glassPlane.has(`${c.x},${c.y},${c.z}`), false,
        `dressing cell ${c.x},${c.y},${c.z} sits on the glass line`);
    }
    assert.strictEqual(dressing.vehicleMinY, street, "the vehicles do not stand on the street band");
  });

  test("arrival lanes clear palms", () => {
    build();
    const { N } = boot();
    const dressing = N.plazaDressing();
    const lane = dressing.lane;
    const overlaps = (r, cx0, cx1, cz0, cz1) =>
      r.x0 <= cx1 && cx0 <= r.x1 && r.z0 <= cz1 && cz0 <= r.z1;
    for (const [px, pz] of palmColumns(N))
      // a palm owns its trunk column and the 3 x 3 canopy one band up
      assert.strictEqual(overlaps(lane, px - 1, px + 1, pz - 1, pz + 1), false,
        `the arrival lane cuts through the palm at ${px},${pz}`);
    const pool = N._plan.POOL;
    assert.strictEqual(overlaps(lane, pool.x0, pool.x1, pool.z0, pool.z1), false,
      "the arrival lane blocks the reflecting pool");
    for (const cx of N._plan.KERB_X.map((v) => v))
      assert.strictEqual(overlaps(lane, cx, cx + 1, -999, 999), false,
        "the arrival lane drives onto the boulevard kerbs");
    // and the vehicles actually park inside that lane
    for (const c of dressing.vehicleCells)
      assert.ok(c.x >= lane.x0 && c.x <= lane.x1 && c.z >= lane.z0 && c.z <= lane.z1,
        `vehicle cell ${c.x},${c.y},${c.z} is outside the arrival lane`);
  });

  test("the marquee stands its posts on the ground and spans the lane overhead", () => {
    build();
    const { N } = boot();
    const dressing = N.plazaDressing();
    assert.ok(dressing.marqueeCells.length > 0, "there is no marquee");
    const street = N._plan.STREET;
    let baseY = Infinity, topY = -Infinity, xs = [];
    const topBand = new Set();
    for (const c of dressing.marqueeCells) {
      baseY = Math.min(baseY, c.y);
      topY = Math.max(topY, c.y);
    }
    for (const c of dressing.marqueeCells) if (c.y === topY) topBand.add(c.x);
    for (const x of topBand) xs.push(x);
    xs.sort((a, b) => a - b);
    assert.strictEqual(baseY, street, "the marquee posts do not touch the ground");
    assert.ok(topY > street + 1, "the marquee beam sits low enough to block the lane view");
    const span = xs[xs.length - 1] - xs[0];
    assert.ok(span >= 16, `the beam spans only ${span} cells - too short to cross the entrance`);
  });

  test("the dressings light up warm", () => {
    build();
    const { N } = boot();
    const dressing = N.plazaDressing();
    assert.ok(dressing.lightCells.length > 0, "no lights on the dressings");
    for (const c of dressing.lightCells)
      assert.strictEqual(N.glass.lit(c.id), true,
        `light cell ${c.x},${c.y},${c.z} is not a warm id`);
    // both kinds: vehicle lamps at the cars (low band) and the marquee banner (high)
    assert.ok(dressing.lightCells.some((c) => c.y <= 1), "no vehicle lamps");
    assert.ok(dressing.lightCells.some((c) => c.y >= 2), "no marquee banner lights");
  });

  test("the dressing batch claims each cell exactly once, and caches its batch", () => {
    build();
    const { N } = boot();
    const dressing = N.plazaDressing();
    const parts = dressing.vehicleCount + dressing.marqueeCount + dressing.lightCount;
    assert.strictEqual(dressing.countVox, parts,
      `occupancy holds ${dressing.countVox} cells but the parts add up to ${parts} - a cell is claimed twice`);
    let emissions = 0;
    const orig = N.vox.addRun;
    N.vox.addRun = (...a) => { emissions++; return orig(...a); };
    const runs = N.vox.runs().length, voxCount = N.vox.count;
    const second = N.plazaDressing();
    N.vox.addRun = orig;
    assert.strictEqual(emissions, 0, "the second call must not re-emit into the shared buffer");
    assert.strictEqual(second, dressing, "the cached batch is the same object");
    assert.strictEqual(N.vox.runs().length, runs, "run count unchanged");
    assert.strictEqual(N.vox.count, voxCount, "voxel count unchanged");
  });
});

// --- Task 9: roof gun-run, tile helo -------------------------------------
// Everything in this batch lives above the roof deck - the one region of the
// scene where the camera rules say a lens may always go (over the deck is
// outside by definition). The roof stack is what the tile helo has pulled out
// of the facade and parked on the deck, so it uses the shatter glass id that
// Appendix A already pins. The penthouse is the only thing on the deck that
// reaches above it, so nothing in this batch may sit inside the penthouse box.
describe("roof, run, helo", () => {
  test("the run stacks sit on the roof line, inside the tower bounds, none inside the envelope", () => {
    build();
    const { N } = boot();
    const roof = N.roofWorld();
    const U = N.tower.sections.upper;
    const PH = N.tower.sections.penthouse;
    assert.ok(roof.stackCells.length > 0, "there is no stacked run on the roof");
    assert.strictEqual(roof.stackMinY, N.tower.roofDeck + 1,
      `stacks start at ${roof.stackMinY}, not on the roof line ${N.tower.roofDeck + 1}`);
    const inBounds = (c) => c.x >= U.x0 && c.x <= U.x1 && c.z >= U.z0 && c.z <= U.z1;
    const inPenthouse = (c) => c.x >= PH.x0 && c.x <= PH.x1 && c.z >= PH.z0 && c.z <= PH.z1 &&
      c.y >= PH.y0 && c.y <= PH.y1;
    for (const c of roof.stackCells) {
      assert.strictEqual(N.envelope.isOutside({ x: c.x, y: c.y, z: c.z }), true,
        `stack cell ${c.x},${c.y},${c.z} is inside the envelope`);
      assert.strictEqual(inBounds(c), true, `stack cell ${c.x},${c.y},${c.z} is off the deck`);
      assert.strictEqual(inPenthouse(c), false, `stack cell ${c.x},${c.y},${c.z} is inside the penthouse`);
    }
  });

  test("the tile helo stays above the envelope and never below roof height", () => {
    build();
    const { N } = boot();
    const roof = N.roofWorld();
    assert.ok(roof.heloCells.length > 0, "there is no tile helo");
    assert.ok(roof.heloMinY > N.tower.roofDeck,
      `helo dips to ${roof.heloMinY}, at or below the roof deck ${N.tower.roofDeck}`);
    for (const c of roof.heloCells)
      assert.strictEqual(N.envelope.isOutside({ x: c.x, y: c.y, z: c.z }), true,
        `helo cell ${c.x},${c.y},${c.z} is inside the envelope`);
    // The rotor is the top band, and it is a wide flat run: a helicopter reads
    // as a disc over a body even at voxel scale.
    const disc = [...new Set(roof.heloCells.filter((c) => c.y === roof.heloTopY).map((c) => c.x))];
    assert.ok(disc.length > 8, `the rotor spans only ${disc.length} cells - too narrow for a helo`);
  });

  test("the gun run lies along the penthouse edge, on the deck", () => {
    build();
    const { N } = boot();
    const roof = N.roofWorld();
    const PH = N.tower.sections.penthouse;
    assert.ok(roof.runCells.length > 0, "the brass gun run is missing");
    const deckEdge = PH.z0 - 1;
    for (const c of roof.runCells) {
      assert.strictEqual(c.y, N.tower.roofDeck + 1, `run cell ${c.x},${c.y},${c.z} floats off the deck`);
      assert.ok(c.z === deckEdge || c.z === PH.z1 + 1,
        `run cell ${c.x},${c.y},${c.z} does not hug the penthouse edge`);
    }
    // the stacks are pulled facade glass - the shatter id Appendix A pins
    const shatter = N.glass.ids.shatter;
    assert.ok(roof.stackCells.every((c) => c.id === shatter),
      "the roof stack is not the pulled glass it was supposed to be");
  });

  test("the helo winch holds a tile at deck height, and its lights glow", () => {
    build();
    const { N } = boot();
    const roof = N.roofWorld();
    assert.ok(roof.heloCells.some((c) => c.y === N.tower.roofDeck + 1),
      "the winch line does not reach a tile at deck height");
    assert.ok(roof.lightCells.length > 0, "the helo flies without lights");
    for (const c of roof.lightCells) {
      assert.strictEqual(N.glass.lit(c.id), true, `light cell ${c.x},${c.y},${c.z} is not warm`);
      assert.ok(c.y > N.tower.roofDeck, `light cell ${c.x},${c.y},${c.z} is below the deck`);
    }
  });

  test("the roof batch claims each cell exactly once, and caches its batch", () => {
    build();
    const { N } = boot();
    const roof = N.roofWorld();
    const parts = roof.stackCount + roof.runCount + roof.heloCount + roof.lightCount;
    assert.strictEqual(roof.countVox, parts,
      `occupancy holds ${roof.countVox} cells but the parts add up to ${parts} - a cell is claimed twice`);
    let emissions = 0;
    const orig = N.vox.addRun;
    N.vox.addRun = (...a) => { emissions++; return orig(...a); };
    const runs = N.vox.runs().length, voxCount = N.vox.count;
    const second = N.roofWorld();
    N.vox.addRun = orig;
    assert.strictEqual(emissions, 0, "the second call must not re-emit into the shared buffer");
    assert.strictEqual(second, roof, "the cached batch is the same object");
    assert.strictEqual(N.vox.runs().length, runs, "run count unchanged");
    assert.strictEqual(N.vox.count, voxCount, "voxel count unchanged");
  });
});

// --- Task 10: blast + storm ----------------------------------------------
// The fx is the one batch that is not a batch: it is a function of t, so the
// whole contract is "what does the show look like at this instant". The storm
// window belongs to the clock (R15: shatter lives inside that window and
// restores on the wrap), the blast flash belongs to the blast beat, and the
// fx never writes the shared voxel buffer - the base glass line and the tower
// are never mutated, which is what "restores on the wrap" means mechanically.
describe("blast + storm", () => {
  test("the shatter window is the storm beat, and the broken panes are real curtain glass", () => {
    build();
    const { N } = boot();
    const fx = N.fx;
    assert.strictEqual(fx.window[0], N.clock.start("storm"), "the window does not open on the storm beat");
    assert.strictEqual(fx.window[1] - fx.window[0], N.clock.dur("storm"),
      "the window does not span the storm beat's 95 s");
    for (const t of [0, 300, 389, 485, 700, 734])
      assert.strictEqual(fx.paneCells(t).length, 0, `the facade reads broken at t=${t}, outside the storm`);
    const pane = fx.paneCells(437);
    assert.ok(pane.length > 0, "no broken facade panes mid-storm");
    const glassLine = new Set(N.glass.cells.map((c) => `${c.x},${c.y},${c.z}`));
    const seen = new Set();
    for (const c of pane) {
      const k = `${c.x},${c.y},${c.z}`;
      assert.strictEqual(seen.has(k), false, `pane cell ${k} repeated`);
      seen.add(k);
      assert.strictEqual(glassLine.has(k), true, `pane cell ${k} is not curtain-wall glass`);
      assert.strictEqual(c.id, N.glass.ids.shatter, `pane cell ${k} is not the pinned shatter id`);
    }
    // and the wrap restores it: the base glass line was never mutated, so the
    // same positions read as the glass they were before the window opened
    for (const c of pane)
      assert.notStrictEqual(N.glass.cells.find((g) => g.x === c.x && g.y === c.y && g.z === c.z).id, c.id,
        `pane cell ${c.x},${c.y},${c.z} was swapped in the base glass - a mutation, not a restore`);
  });

  test("the blast flash stands only through the blast beat, clear outside the glass", () => {
    build();
    const { N } = boot();
    const fx = N.fx;
    assert.strictEqual(N.clock.start("blast"), 360, "blast timing must pin v1: first break at 360");
    assert.strictEqual(fx.flashWindow[0], N.clock.start("blast"), "the flash does not open on the blast beat");
    assert.strictEqual(fx.flashWindow[1] - fx.flashWindow[0], N.clock.dur("blast"),
      "the flash does not span the blast beat");
    for (const t of [0, 359, 390, 484, 700])
      assert.strictEqual(fx.flashCells(t).length, 0, `flash visible at t=${t}`);
    const flash = fx.flashCells(370);
    assert.ok(flash.length > 0, "the blast lands without a flash");
    for (const c of flash) {
      assert.strictEqual(N.envelope.isOutside({ x: c.x, y: c.y, z: c.z }), true,
        `flash cell ${c.x},${c.y},${c.z} is inside the envelope - the lens could never stay clear of it`);
      assert.strictEqual(c.id, N.glass.ids.shatter, `flash cell ${c.x},${c.y},${c.z} is not the pinned shatter id`);
    }
  });

  test("the shards fall and drift away from the facade, never inside the envelope", () => {
    build();
    const { N } = boot();
    const fx = N.fx;
    for (const t of [0, 389, 485, 700])
      assert.strictEqual(fx.shardCells(t).length, 0, `shards on screen at t=${t}, outside the storm`);
    const minZ = (cells) => Math.min(...cells.map((c) => c.z));
    const maxY = (cells) => Math.max(...cells.map((c) => c.y));
    const early = fx.shardCells(400), late = fx.shardCells(460), last = fx.shardCells(484);
    assert.ok(early.length > 0 && late.length > 0 && last.length > 0, "the burst needs shards throughout the window");
    for (const cells of [early, late, last])
      for (const c of cells) {
        assert.strictEqual(N.envelope.isOutside({ x: c.x, y: c.y, z: c.z }), true,
          `shard ${c.x},${c.y},${c.z} is inside the envelope - a falling shard must clear the camera's shell`);
        assert.ok(c.y >= 2, `shard ${c.x},${c.y},${c.z} has already hit the street`);
      }
    assert.ok(minZ(late) < minZ(early), "the burst never drifts away from the facade - shards need an outward push");
    assert.ok(maxY(last) < maxY(early), "the shards never fall - the glass must drop toward the street");
  });

  test("the fx is a deterministic function of t and never touches the shared buffer", () => {
    build();
    const { N } = boot();
    const join = (cells) => cells.map((c) => `${c.x},${c.y},${c.z},${c.id}`).join("|");
    assert.strictEqual(join(N.fx.shardCells(437)), join(N.fx.shardCells(437)), "the same t must draw the same burst");
    assert.strictEqual(join(N.fx.paneCells(437)), join(N.fx.paneCells(437)), "the same t must draw the same pane");
    const runs = N.vox.runs().length, voxCount = N.vox.count, glassCells = N.glass.cells.length;
    for (let t = 355; t < 500; t += 7) {
      N.fx.paneCells(t); N.fx.shardCells(t); N.fx.flashCells(t);
    }
    assert.strictEqual(N.vox.runs().length, runs, "the fx emitted into the shared buffer - it must stay a overlay layer");
    assert.strictEqual(N.vox.count, voxCount, "the voxel count changed - the world is not the world after the fx");
    assert.strictEqual(N.glass.cells.length, glassCells, "the glass line was mutated - there is nothing to restore on the wrap");
  });

  test("every fx cell wears the pinned shatter id 0xd003", () => {
    build();
    const { N } = boot();
    assert.strictEqual(N.glass.ids.shatter, 0xd003, "the appendix pins the shard id at 0xd003");
    const all = []
      .concat(N.fx.paneCells(437), N.fx.flashCells(370), N.fx.shardCells(437));
    assert.ok(all.length > 0, "the fx needs visible cells to name");
    for (const c of all)
      assert.strictEqual(c.id, 0xd003, `fx cell ${c.x},${c.y},${c.z} wears id 0x${Number(c.id).toString(16)} - the appendix says 0xd003`);
  });
});

// --- Task 11: police convoy + fed arrival ---------------------------------
// The convoy is the other half of the response: the FCPD cruisers that make a wall
// in front of the tower, the Feds' black SUVs along the boulevard, and the lead car
// that took the ramp down into the sunken driveway under the bridge. Like the
// dressing batch (Task 8) it is entirely outside the envelope, and unlike Task 8 it
// has a route as well as parked cells - the boulevard approach, the driveway loop,
// the black-and-white's position - because Task 12's camera pulls back along it.
describe("convoy + feds", () => {
  // Expanded into a cell set straight from the batches, so the test never trusts a
  // guessed key: the merged buffer is the truth the page renders.
  const cellSet = (runs) => {
    const s = new Set();
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      for (let k = 0; k < r.len; k++) s.add(`${r.x + k}|${r.y}|${r.z}`);
    }
    return s;
  };

  test("the convoy belongs to the fed beats, from the boulevard to the wall of cars", () => {
    build();
    const { N } = boot();
    const c = N.convoy;
    assert.strictEqual(c.window[0], N.clock.start("fedConvoy"),
      "the convoy does not open on the fed convoy beat");
    assert.strictEqual(c.window[1], N.clock.start("wallOfCars") + N.clock.dur("wallOfCars"),
      "the convoy does not run to the end of the wall-of-cars beat");
    assert.ok(c.window[0] < N.clock.BEAT_END && c.window[1] <= N.clock.BEAT_END,
      "the convoy window is not inside the beat timeline");
    assert.ok(c.route.length >= 4, "the route needs waypoints to be a route");
  });

  test("the route follows the boulevard, dips into the sunken driveway, and never enters the tower", () => {
    build();
    const { N } = boot();
    const c = N.convoy;
    // The plan's own probe: 20 points deep along the path, every one on the block and
    // outside the tower's shell. A route that clips the podium is a route the show's
    // camera could never follow.
    const seen = [];
    for (let i = 0; i <= 20; i++) {
      const p = c.routeAt(i / 20);
      seen.push(p);
      assert.strictEqual(N.isOnGround(p.x, p.z), true,
        `route point ${p.x},${p.z} is off the block - the convoy drives through the city`);
      assert.strictEqual(N.envelope.isOutside({ x: p.x, y: p.y, z: p.z }), true,
        `route point ${p.x},${p.y},${p.z} is inside the envelope - the convoy drives through the tower`);
    }
    // The approach comes in at the block's edge, and the route ends at the parked
    // wall - the last waypoint is the lane the convoy stops in, just off the front
    // of the cruisers it stages there.
    const first = c.routeAt(0), last = c.routeAt(1);
    assert.strictEqual(first.z, N._plan.BLOCK.z0, "the convoy does not arrive at the block's edge");
    const stage = c.stage;
    assert.strictEqual(last.z, stage.z1 + 1,
      "the route does not stop in the lane in front of the wall of cars");
    assert.ok(last.x >= stage.x0 && last.x <= stage.x1, "the route stops outside the staging band");
    const inDitch = (p) => {
      const d = N._plan.DITCH_RECT;
      return p.x >= d.x0 && p.x <= d.x1 && p.z >= d.z0 && p.z <= d.z1 && p.y < N._plan.STREET;
    };
    assert.ok(seen.some(inDitch), "the route never takes the driveway loop down the ramp");
    assert.ok(seen.some((p) => p.y === N._plan.STREET), "the route never runs along the street level");
    // the kerb strips are the boulevard's edge: the approach lane must stay inside them
    const kerbIn = (p) => N._plan.KERB_X.some((k) => p.x >= k && p.x <= k + 1);
    assert.strictEqual(seen.filter(kerbIn).length, 0, "the convoy drives on the boulevard kerbs");
    // and the staging band it stops at is itself clear of the building and the pool
    assert.ok(stage.z1 < N._plan.POOL.z0, "the staging band sits behind the reflecting pool");
    for (const z of [stage.z0, stage.z1])
      assert.strictEqual(N.envelope.isOutside({ x: 0, y: N._plan.STREET, z: z }), true,
        `the staging band at z=${z} is inside the envelope - the wall of cars would be inside the tower`);
  });

  test("staged vehicles stand on the block, clear of the tower, and re-claim nobody's cells", () => {
    build();
    const { N } = boot();
    const w = N.convoyWorld();
    const all = []
      .concat(w.cruiserCells.map((c) => ({ ...c })), w.fedCells.map((c) => ({ ...c })),
        w.drivewayCells.map((c) => ({ ...c })));
    assert.ok(all.length > 0, "the convoy has no staged vehicles");
    const groundCells = cellSet(N.ground().voxels.map((r) => ({ x: r.x, y: r.y, z: r.z, len: r.len })));
    const dressingCells = cellSet(N.plazaDressing().voxels.map((r) => ({ x: r.x, y: r.y, z: r.z, len: r.len })));
    const glassLine = new Set(N.glass.cells.map((c) => `${c.x},${c.y},${c.z}`));
    const ditch = N._plan.DITCH_RECT, floor = N._plan.DITCH;
    for (const c of all) {
      const k = `${c.x}|${c.y}|${c.z}`;
      assert.strictEqual(N.envelope.isOutside({ x: c.x, y: c.y, z: c.z }), true,
        `convoy cell ${k} is inside the envelope - the camera rules forbid it`);
      assert.strictEqual(N.isOnGround(c.x, c.z), true, `convoy cell ${k} is off the block`);
      assert.ok(c.y > floor, `convoy cell ${k} is under the sunken driveway floor`);
      assert.strictEqual(groundCells.has(k), false, `convoy cell ${k} re-claims a ground cell`);
      assert.strictEqual(dressingCells.has(k), false, `convoy cell ${k} re-claims a dressing cell`);
      assert.strictEqual(glassLine.has(k), false, `convoy cell ${k} sits on the glass line`);
      // a vehicle in the sunken cut must be inside that cut, not anywhere on the block
      const inCut = c.x >= ditch.x0 && c.x <= ditch.x1 && c.z >= ditch.z0 && c.z <= ditch.z1;
      if (c.y < N._plan.STREET)
        assert.strictEqual(inCut, true, `convoy cell ${k} floats under the paving, outside the driveway`);
    }
  });

  test("the black-and-white wears two paint ids, the feds their own, and every cruiser a lightbar", () => {
    build();
    const { N } = boot();
    const w = N.convoyWorld();
    assert.ok(w.cruiserCount >= 3 && w.fedCount >= 2, "the response needs a wall of cars and Feds");
    // one cruiser has both halves of the classic two-tone paint
    const paintIds = new Set(w.cruiserCells.map((c) => c.id));
    assert.ok(paintIds.has(w.ids.cruiser) && paintIds.has(w.ids.cruiserBand),
      "no cruiser wears the black-and-white's two-tone paint");
    for (const c of w.fedCells)
      assert.ok(c.id === w.ids.fed || c.id === w.ids.fedGlass,
        `fed cell ${c.x},${c.y},${c.z} wears a cruiser id - the Feds are their own cars`);
    // the responders' lights are what the beat reads as: red and blue, up above the cabin
    const bars = w.lightCells.map((c) => ({ ...c }));
    assert.ok(bars.length > 0, "no responder lights on the cruisers");
    const barIds = new Set(bars.map((c) => c.id));
    assert.strictEqual(barIds.has(w.ids.lightRed) && barIds.has(w.ids.lightBlue), true,
      "the lightbars are not both responder colours");
    for (const c of bars) {
      assert.ok(c.y > N._plan.STREET, `lightbar cell ${c.x},${c.y},${c.z} is at street level`);
      assert.ok(c.y <= N._plan.STREET + 2, `lightbar cell ${c.x},${c.y},${c.z} is taller than a car`);
    }
    // red and blue are separate palette entries, not one glowing blob
    assert.notStrictEqual(w.ids.lightRed, w.ids.lightBlue, "the two responder colours are one id");
  });

  test("the convoy batch counts each cell exactly once, and caches itself", () => {
    build();
    const { N } = boot();
    const w = N.convoyWorld();
    // The batch number, pinned the way the ground's 9406 and the dressing's 138 are:
    // 9 cruisers at 10 cells each, 3 Feds at 16, the lead car with its marker.
    assert.strictEqual(w.countVox, 147, "the locked convoy batch number");
    const parts = w.cruiserCells.length + w.fedCells.length + w.drivewayCells.length;
    assert.strictEqual(parts, 90 + 48 + 9, "the convoy's parts breakdown is not the one that was staged");
    assert.strictEqual(w.countVox, parts,
      `occupancy holds ${w.countVox} cells but the parts add up to ${parts} - a cell is claimed twice`);
    assert.strictEqual(w.carCount, w.cruiserCount + w.fedCount + w.drivewayCount,
      "the car count is not the sum of the three kinds");
    let emissions = 0;
    const orig = N.vox.addRun;
    N.vox.addRun = (...a) => { emissions++; return orig(...a); };
    const runs = N.vox.runs().length, voxCount = N.vox.count;
    const second = N.convoyWorld();
    N.vox.addRun = orig;
    assert.strictEqual(emissions, 0, "the second call must not re-emit into the shared buffer");
    assert.strictEqual(second, w, "the cached batch is the same object");
    assert.strictEqual(N.vox.runs().length, runs, "run count unchanged");
    assert.strictEqual(N.vox.count, voxCount, "voxel count unchanged");
  });
});

describe("camera rig", () => {
  // The witness point, as the page sees it: the lens's own cell. R12/R13 are
  // about where the lens stands, so the test asks the question the renderer asks.
  const lensCell = (pos) => ({
    x: Math.floor(pos.x + 1e-9), y: Math.floor(pos.y + 1e-9), z: Math.floor(pos.z + 1e-9),
  });

  test("every witness point passes isOutside - twelve samples per beat", () => {
    build();
    const { N } = boot();
    assert.ok(N.rig && typeof N.rig.keys === "function" && typeof N.rig.sample === "function",
      "NAKATOMIC.rig exposes keys(id) and sample(id, t)");
    for (const id of N.clock.order) {
      const t0 = N.clock.start(id);
      const t1 = t0 + N.clock.dur(id);
      for (let i = 0; i <= 12; i++) {
        const t = t0 + ((t1 - t0) * i) / 12;
        const key = N.rig.sample(id, t);
        assert.ok(key && key.pos, `beat ${id} has no lens at t=${t}`);
        const c = lensCell(key.pos);
        assert.strictEqual(N.envelope.isOutside(c), true,
          `t=${t} (${id}) puts the lens inside the envelope at ${c.x},${c.y},${c.z}`);
        assert.ok(c.x >= -60 && c.x <= 60 && c.z >= -70 && c.z <= 70 && c.y >= 1 && c.y <= 80,
          `t=${t} (${id}) puts the lens outside the model world at ${c.x},${c.y},${c.z}`);
        assert.ok(key.fov >= 35 && key.fov <= 60,
          `t=${t} (${id}) shoots with fov ${key.fov} outside the 35..60 clamp`);
      }
    }
  });

  test("the glass-line key is 3.5 cells off the curtain wall and still outside", () => {
    build();
    const { N } = boot();
    const face = N.glass.cells.filter((c) => c.z === N.tower.sections.lower.z0);
    assert.ok(face.length > 0, "the atrium face has no glass to shoot past");
    const near = N.clock.order.map((b) => N.rig.keys(b)).flat()
      .filter((k) => Math.abs(k.pos[0] - (N.tower.sections.lower.x1 + 3.5)) < 0.001);
    assert.ok(near.length > 0, "no lens sits on the glass-line key 3.5 cells from the wall");
    for (const k of near) {
      const c = lensCell({ x: k.pos[0], y: k.pos[1], z: k.pos[2] });
      assert.strictEqual(N.envelope.isOutside(c), true,
        `the glass-line key at ${c.x},${c.y},${c.z} is inside the envelope`);
      assert.ok(k.pos[1] <= N.tower.sections.lower.y1, "the glass-line key is not at plaza level");
    }
  });

  test("the take follows the beat order and never teleports", () => {
    build();
    const { N } = boot();
    const all = N.rig.all();
    // The keys are one track: strictly increasing in time, and the beats they
    // belong to appear in clock.order. A key outside its beat's window would make
    // the beat windows disagree with the plan's Beat Table.
    for (let i = 1; i < all.length; i++)
      assert.ok(all[i].t > all[i - 1].t, `key ${i} at t=${all[i].t} is not after key ${i - 1}`);
    let beatIdx = 0;
    for (const k of all) {
      while (beatIdx + 1 < N.clock.order.length &&
        k.t > N.clock.start(N.clock.order[beatIdx]) + N.clock.dur(N.clock.order[beatIdx]))
        beatIdx++;
      const b = N.clock.order[beatIdx];
      assert.ok(k.t >= N.clock.start(b) && k.t <= N.clock.start(b) + N.clock.dur(b),
        `key at t=${k.t} belongs to ${b}'s window`);
    }
    // Consecutive frames: the lens walks, it does not jump. A 0.2 s frame step
    // over the whole take is 3575 samples; a cut would show up as a step of
    // tens of cells. 3 cells per frame is 15 cells/s - the fastest legitimate
    // dolly move in the take (the blast beat's north descent, ~13 cells/s).
    const step = 0.2;
    let prev = N.rig.sample("open", 0);
    let maxStep = 0;
    for (let t = step; t <= N.clock.BEAT_END + 1e-9; t += step) {
      const f = N.clock.beatAt(t);
      const s = N.rig.sample(f ? f.id : "drestle", t);
      const d = Math.hypot(s.pos.x - prev.pos.x, s.pos.y - prev.pos.y, s.pos.z - prev.pos.z);
      maxStep = Math.max(maxStep, d);
      assert.ok(d < 3, `t=${t} jumps ${d.toFixed(2)} cells - the take cut, it did not dolly`);
      assert.ok(s.fov >= 35 && s.fov <= 60, `t=${t} shoots with fov ${s.fov}`);
      prev = s;
    }
    assert.ok(maxStep > 0, "the take never moved: every key is the same pose");
    // The pull-back for the fed beats follows the convoy's route: the lens stays
    // west of the lane it shoots, and never crosses the tower to get there.
    for (const k of N.rig.routeKeys("fedConvoy")) {
      const cell = lensCell({ x: k.pos[0], y: k.pos[1], z: k.pos[2] });
      assert.strictEqual(N.envelope.isOutside(cell), true,
        `route key at t=${k.t} is inside the envelope at ${cell.x},${cell.y},${cell.z}`);
      assert.ok(cell.x < 0, `route key at t=${k.t} pulls back on the wrong side of the block`);
    }
  });
});

// --- Task 13: audio queue + HUD beat labels --------------------------------
describe("audio + HUD", () => {
  test("no event fires in the hold window without a hold label", () => {
    build();
    const { N } = boot();
    const q = N.audio.queue;
    assert.ok(Array.isArray(q) && q.length > 0,
      "the queue is data, so it can be enumerated before a browser unlocks the audio");
    // The plan's invariant (Review Focus 5): every entry sits inside the beat
    // timeline, or carries an explicit hold marker. A sound during the hold is
    // only legal because it says so - which is why the invariant is an equality,
    // not just a floor.
    let prev = -Infinity;
    for (const e of q) {
      assert.ok(e.t > prev, `queue entry ${e.name}@${e.t} arrives out of order`);
      prev = e.t;
      const inHold = e.t >= N.clock.BEAT_END;
      assert.strictEqual(!!e.hold, inHold,
        `${e.name}@${e.t} is ${inHold ? "in the hold window" : "before BEAT_end"} without a hold label`);
    }
    assert.ok(q.some((e) => e.hold), "nothing audible plays in the hold window either");
  });

  test("the audio queue is keyed to the beat table", () => {
    build();
    const { N } = boot();
    for (const e of N.audio.queue) {
      assert.ok(e.name in N.audio.voices, `${e.name}@${e.t} has no voice to synth it`);
      if (e.hold) continue;
      // No hand-kept times: an entry's beat decides where it sits.
      assert.ok(N.clock.order.includes(e.id), `${e.name}@${e.t} keys to a beat outside clock.order`);
      const s = N.clock.start(e.id);
      assert.ok(e.t >= s && e.t < s + N.clock.dur(e.id),
        `${e.name}@${e.t} sits outside the window of ${e.id}`);
    }
    // The three voices the plan names actually reach the show.
    for (const [name, beat] of [["whomp", "tileHelo"], ["crack", "blast"], ["siren", "storm"]])
      assert.ok(N.audio.queue.some((e) => e.name === name && e.id === beat),
        `no ${name} fires during ${beat}`);
  });

  test("HUD null beat label falls back to hold text", () => {
    build();
    const { N } = boot();
    // beatAt is null through the hold: a null beat is not a missing label, it is
    // the hold, and it needs a label.
    assert.strictEqual(N.hud.label({ t: N.clock.BEAT_END, beat: null }), N.clock.HOLD_LABEL);
    assert.strictEqual(N.hud.label({ t: N.clock.BEAT_END + 3.5, beat: null }), N.clock.HOLD_LABEL);
    // The scene defers to the same function, so the page's label and the HUD's
    // cannot drift apart.
    assert.strictEqual(N.scene.label({ t: N.clock.BEAT_END + 1, beat: null }), N.clock.HOLD_LABEL,
      "the scene's hold fallback moved away from the HUD's");
    // A frame without an explicit beat reads the clock live: that is what "driven
    // by beatAt()" means, not "whatever the caller handed over".
    const t = N.clock.start("blast") + 1;
    assert.strictEqual(N.hud.label({ t }), N.clock.beatAt(t).label);
    // A frame before the show is invalid, not "hold": it gets no label.
    assert.strictEqual(N.hud.label({ t: -1, beat: null }), "");
  });

  test("pump fires only the crossings inside a frame", () => {
    build();
    const { N } = boot();
    // The sandbox has no AudioContext: the queue still walks the show, so the
    // gate counts crossings and the page schedules the same ones it reports.
    const blastT = N.clock.start("blast");
    const near = N.audio.eventsBetween(blastT - 2, blastT + 2);
    assert.ok(near.length > 0, "nothing fires within 2 s of the blast");
    assert.ok(near.every((e) => e.t > blastT - 2 && e.t <= blastT + 2),
      "eventsBetween leaked an event outside its window");
    assert.strictEqual(N.audio.eventsBetween(blastT + 2, blastT - 2).length, 0,
      "a step backwards through the show still schedules crossings");
    // The wrap hands pump a frame back at t=0: it must not replay the timeline.
    const beforeHold = N.audio.queue.filter((e) => e.t < N.clock.BEAT_END).length;
    N.audio.reset();
    N.audio.pump({ t: N.clock.BEAT_END, beat: null, wrapped: false });
    assert.strictEqual(N.audio.fired, beforeHold,
      "a pass through the whole show fires every entry once, in order");
    assert.strictEqual(N.audio.pump({ t: 0, beat: null, wrapped: true }), 0,
      "the wrap frame replayed the show from the top");
    assert.strictEqual(N.audio.fired, beforeHold, "the wrap frame also kept the counter clean");
  });
});

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await run(process.argv[2] || null);
}
