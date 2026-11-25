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
    const keys = "camera domElement follow fov framing gl label paused rebuild restart running setFraming setPose start stats step togglePause".split(" ").sort();
    assert.deepStrictEqual(Object.keys(N.scene).sort(), keys, "scene keys are pinned");
    for (const k of ["start", "rebuild", "setFraming", "setPose", "step", "label", "togglePause", "restart"])
      assert.strictEqual(typeof N.scene[k], "function", `scene.${k} is a function`);
    assert.strictEqual(N.scene.running, false, "the loop is not running until start()");
    assert.strictEqual(N.scene.gl, null, "no renderer before start()");
    assert.deepStrictEqual(Object.keys(N.scene.stats).sort(), "fps points voxels".split(" ").sort(), "stats keys");
    // The hold fallback needs no beat label to exist: label() answers for the hold.
    assert.strictEqual(N.scene.label({ t: N.clock.BEAT_END + 1, beat: null }), N.clock.HOLD_LABEL, "hold fallback label");
    assert.strictEqual(N.scene.label({ t: 360, beat: N.clock.beatAt(360) }), N.clock.beatAt(360).label, "beat label");
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await run(process.argv[2] || null);
}
