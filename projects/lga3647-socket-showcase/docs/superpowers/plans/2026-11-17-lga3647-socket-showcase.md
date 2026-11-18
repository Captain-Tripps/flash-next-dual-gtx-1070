# LGA 3647 Socket Showcase Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A single dependency-free `index.html` that renders an LGA 3647 CPU socket as a mechanical showcase — gold land-grid, ILS bracket, load plate hinging open on a cycle, slow orbiting camera.

**Architecture:** Hand-written WebGL 2, everything inline in one file. A tiny named-node scene graph holds generated geometry (profile extrusions, chamfered planes); the ~3.6k pads are one instanced draw call. Pure functions (layout, plate keyframes, camera pose) live outside the GL code so they can be unit-tested with no browser.

**Tech Stack:** WebGL 2 (GLSL ES 3.00), vanilla ES module inline `<script type="module">`, no build step. Node 20+ for the logic test harness (`verify/unit.mjs`) which extracts the inline module from the HTML and evaluates it with a stub `window`. Verification of pixels: `verify/render.mjs` driving the `agent-browser` CLI.

**Spec:** `../../DESIGN.md` (repo-root `DESIGN.md`). Read both documents before implementing.

## Global Constraints

- One file only: `index.html`. No `.js`/`.glsl`/asset siblings, no CDN, no `fetch`, no `import` of any external URL.
- No external model files, no textures: geometry and gradients generated in code.
- 60 fps target on an integrated GPU: the pad field is **one instanced draw call**, never one mesh per pad.
- Must work over `file://` in Chrome: **inline module only, no module import specifiers** (file:// opaque-origin blocks them). Any `import` breaks the deliverable.
- No user gesture required to see the animation: it autoplays.
- Everything named: GLSL programs, part nodes and shader programs are named in the diagnostics object so the verification harness can assert on them.

## Review Focus

The spec is silent on these; a person opening the file will hit them. Each line is pinned by a test in the named task.

1. **WebGL2 unavailable / context lost** (Firefox ESR, headless, some iGPU driver blocks): the page must show a readable "WebGL2 not available" overlay naming the cause, not a black canvas or a silent `null` context crash. (Task 1)
2. **`file://` protocol** (Jon double-clicks the file rather than serving it): inline-module only; page must render with no CORS/network errors in console. (Task 1)
3. **HiDPI / window resize**: canvas backing store must match `devicePixelRatio` and re-fit on resize without stretching the pads or NaN-ing the projection. (Task 1, Task 6)
4. **Extreme viewport** (0-height panel, 21:9 ultrawide, or a resized-to-tiny window): aspect ratio must be clamped, never divide-by-zero, never a degenerate frustum. (Task 6)
5. **Backgrounded tab / long frame** (rAF throttled to 1 Hz or a devtools pause): the plate cycle and orbit must not jump to a huge delta-time and snap the plate to its end pose. (Task 7)

---

## File Structure

| File | Responsibility |
|---|---|
| `index.html` | The deliverable. Inline CSS + inline `<script type="module">` holding: math, scene graph, part builders, shaders, GL bootstrap, HUD, loop. |
| `verify/unit.mjs` | Test harness. Reads `index.html`, extracts the inline module into a Function with a stub `document`/`window`, calls the exported pure functions, asserts. Exits non-zero on failure. |
| `verify/render.mjs` | Drives `agent-browser` to load the page, run in-page end-state assertions via `eval`, and screenshot. |
| `notes/` | Scratch. Not part of the deliverable. |

The inline module ends with `window.__scene = diagnostics;` and `export`-free — the harness reaches it by evaluating the source, so the module must not touch anything outside `window` at top level except a `const`-scoped registry.

### Interfaces the harness and later tasks rely on

```js
// pure, no GL
mat4.identity(): Float32Array(16)
mat4.multiply(out, a, b): out            // out is a,b in, right-multiplied (column-major, like WebGL)
mat4.trs(out, {pos, rot, scale}): out    // rot = {x,y,z} radians, applied Y→X→Z
mat4.perspective(out, {fovyDeg, aspect, near, far}): out
mat4.lookAt(out, eye, target, up): out
composeLayout({ cols, rows, padPitch, padSize, cutouts }):
    { instanceCount, data: Float32Array /* interleaved x, z, size, tone per instance */ }
platePose(t): { phase, latchAngle, plateAngle, openT }
    // phase in "closed"|"unlatching"|"opening"|"open"|"closing"; angles in degrees
cameraPose(elapsedMs): { azimuthDeg, elevationDeg, radius, target }
// GL side (built once, then per-frame)
buildParts(): Map<string, Part>   // keys: "substrate","frame","padField","brBracket",
                                  // "loadPlate","hingeBar","latchLever","stiffenRing"
```

## Task 1: Page shell, GL bootstrap, diagnostics, error overlay

**Files:** Create `index.html`; Create `verify/unit.mjs`; Create `verify/render.mjs`
**Interfaces:** Produces `window.__scene = { ok, cause, parts, programs, frames, padCount, plateAngleDeg, azimuthDeg }`, `getCanvasSize()`.

- [x] **Step 1: Write the failing test** — `verify/unit.mjs`: extract the inline module and assert `window.__scene.ok === false` when the harness stubs `canvas.getContext` to return `null`, and that `__scene.cause` mentions `webgl2`. Also assert the source contains no `import ` specifier and no `fetch(`.
- [x] **Step 2: Run** `node verify/unit.mjs` — expect FAIL: "no inline module found" / undefined extraction.
- [x] **Step 3: Implement** `index.html`: `<canvas id="viewport">` full-window, inline module that creates the context via `canvas.getContext("webgl2", {antialias:true})`, fills `#error-overlay` (hidden div, styled) with the reason on failure, sets a 1×1 clear colour, installs the rAF loop with `dtMs = clamp(now-last, 0, 50)`, and publishes `__scene`. Also `verify/render.mjs` skeleton: `agent-browser open <abs file url>` → `agent-browser wait 1500` → `agent-browser eval "__scene"` → print. Use `JSON.stringify` and the documented IIFE-wrapped-eval rule.
- [x] **Step 4: Run** `node verify/unit.mjs`; then `node verify/render.mjs` — expect PASS: `ok:true`, zero console errors from `agent-browser errors`, canvas pixel size > 0.
- [x] **Step 5: Commit** `git add -A; git commit -m "feat: html shell + webgl2 bootstrap with diagnostics overlay"`.

## Task 2: mat4 / scene-graph math

**Files:** Modify `index.html`; Test: `verify/unit.mjs`
**Interfaces:** Consumes `mat4.*` signatures above. Produces `Node` class: `new Node(name)`, `.parent`, `.local`, `.world(out)`, `.children`, `.worldMatrix()`.

- [x] **Step 1: Failing tests** — `mat4.multiply` with a Y-rotation by 90° maps local +X to −Z; `mat4.trs` composes translate-then-rotate; `world()` for a child at local +Z of a parent rotated 90° about Y gives the expected world position (this is the hinge pivot test, keep it); `perspective` with `aspect=0.5` produces finite numbers, and `lookAt` produces a negated-z forward basis.
- [x] **Step 2: Run** → FAIL (functions undefined).
- [x] **Step 3: Implement** the math block, column-major, no allocation in the hot path (`world(out)` writes into `out`).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `git commit -am "feat: column-major mat4 + named node scene graph"`.

## Task 3: Geometry primitives and the mechanical parts

**Files:** Modify `index.html`; Test: `verify/unit.mjs`
**Interfaces:** Produces `extrudeProfile(profile, {depth, chamfer}) -> {pos, nrm, idx}`, `roundedRectProfile(w, r, segs) -> Float32Array`, and `buildParts()` returning the 8 named parts. Produes each part's `bbox` for the assertions.

- [x] **Step 1: Failing tests** — assert `buildParts()` has exactly the 8 keys; assert substrate bbox footprint ≈ 75.9 × 61.4 in mm-scaled units (`approx` within 1%); assert every part's `idx.length > 0`, every `pos` entry is finite (no NaN), `pos.length/3 === vertex count`; assert `roundedRectProfile(6, 0.8, 4)` has 4 corner arcs and no duplicated consecutive points.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** `buildParts()`: substrate (ceramic, thin, with the corner notch chamfer), frame (anodized surround with opening), pad field placeholder (Task 4 owns it), ILS bracket (two tabs + screw bosses), load plate (rectangular with a hinged edge lip and a latch hook), hinge bar (cylinder along the hinge line), latch lever, stiffener ring. One draw of geometry, no shading yet: normals must be present.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `"feat: generated socket geometry parts (substrate, bracket, plate)"`.

## Task 4: LGA 3647 pad field — instanced, with the centre cutout

**Files:** Modify `index.html`; Test: `verify/unit.mjs`
**Interfaces:** Consumes `mat4`, `composeLayout`. Produces part `"padField"` with `instanceCount` and an interleaved instance buffer.

- [x] **Step 1: Failing tests** — `composeLayout` with the 3647 row table: `instanceCount` within 3 400–3 800; zero pads whose centre falls inside any declared `cutouts` rect; every pad within the 75.9 × 61.4 envelope minus a 1.4 mm keep-out; `data.length === instanceCount * 4`; the two rows nearest the cutout are shorter than the outermost rows (this is the real socket shape, so keep it).
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** `composeLayout` as the row table (per-row start/end x, split by the centre opening) plus instancing setup for the pad quad (2 tris + a chamfer edge, `ANGLE_instanced_arrays` not needed — WebGL2 core instancing).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `"feat: instanced 3647-pad land grid with centre cutout"`.

## Task 5: Shaders, materials, lights, contact shadow

**Files:** Modify `index.html`; Test: `verify/unit.mjs` + `verify/render.mjs`
**Interfaces:** Produces programs `"std"` (brass/steel/ceramic) and `"pad"`; `drawScene(viewProj, timeMs)`.

- [x] **Step 1: Failing tests** — in-page: `gl.getProgramParameter(..., COMPILE_STATUS)`/`LINK_STATUS` are true for every program; and a pixel probe returns coverage: ≥ 25 % of sampled frame pixels are non-background and ≥ 3 % are "gold-ish" (hue rule: `r > b + 20`, `g > 60`).
- [x] **Step 2: Run** `node verify/render.mjs` → FAIL (no programs / black frame).
- [x] **Step 3: Implement** lighting: one key light, one rim, one fill, GGX-ish specular with roughness per material, gold F0 ≈ (1.00, 0.766, 0.336), a fake hemispherical contact shadow driven by a plane's world Y, `ACES`-ish tonemap, and a subtle vignette + background gradient so the part reads as a studio shot. Multi-tone the pads: per-instance `tone` from the layout drives a small roughness/hue variation so the field shimmers as the camera orbits.
- [x] **Step 4: Run** `node verify/render.mjs` → PASS (both pixel probes).
- [x] **Step 5: Commit** `"feat: gold/steel/ceramic materials + studio lighting"`.

## Task 6: Camera orbit, interaction, projection clamping

**Files:** Modify `index.html`; Test: `verify/unit.mjs` + `verify/render.mjs`
**Interfaces:** Produces `cameraPose(elapsedMs)`, `orbit(dx, dy)`, `zoom(dz)`, `setPlateTarget(deg)`; `fitViewport(w, h, dpr)`.

- [x] **Step 1: Failing tests** — `cameraPose(0)` vs `cameraPose(60_000)`: azimuth advances 12–20° (slow orbit, per spec), elevation drifts within ±8° and never exceeds 5–75°; `fitViewport` with `h=0` and with `21:9` returns clamped `aspect` in [0.35, 3.2] and finite `perspective`; the drag/zoom path mutates the pose target and never lets radius hit 0.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** the orbit: pointer/`drag` and wheel handlers (with `passive:false` preventDefault only on wheel), and DPR-aware `fitViewport` (canvas `width = clientWidth*dpr`, CSS size unchanged, `gl.viewport` per frame).
- [x] **Step 4: Run** `node verify/render.mjs` → PASS; confirm via `agent-browser eval` that canvas backing size changed after a simulated `window.resizeTo`-style dispatch.
- [x] **Step 5: Commit** `"feat: slow auto-orbit camera with drag/zoom + DPR resize"`.

## Task 7: Load plate hinge cycle + HUD

**Files:** Modify `index.html`; Test: `verify/unit.mjs` + `verify/render.mjs`
**Interfaces:** Consumes `Node` hinge parenting. Produces `platePose(t)`, HUD readouts `#phase`, `#azimuth`, `#padCount`, and keyboard `Space` (toggle open/close) + `A` (toggle auto-orbit).

- [x] **Step 1: Failing tests** — `platePose` over the cycle: phases visited in order `closed → unlatching → opening → open → closing`; `plateAngle` reaches ~104° (`openT` at the end of "opening") then returns to 0 within one cycle; `latchAngle` stays 0 while `phase === "closed"`; **dt-clamp Review-Focus test**: the loop's advance helper called with `dtMs = 5000` steps the cycle ≤ its per-frame maximum (no snap to end pose).
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** `platePose` as a keyframe table (not per-frame accumulators, so it stays scrub-safe) and wire the plate/latch/hinge-bar nodes as children of a `"hingePivot"` node at the real hinge line; publish the live `__scene.plateAngleDeg` for the harness.
- [x] **Step 4: Run** `node verify/render.mjs` → PASS, including an in-page assertion that `__scene.plateAngleDeg` crosses 90° at least once during a 12 s sample window (drive-then-assert on the **end state**, not on CSS/DOM symptoms).
- [x] **Step 5: Commit** `"feat: load plate hinge cycle + part labels/HUD"`.

## Task 8: Final showcase pass — visual verification of end state

**Files:** Modify `index.html` (polish only), `verify/render.mjs`
**Interfaces:** Consumes everything.

- [x] **Step 1: Extend** `verify/render.mjs` to capture three poses — plate closed, plate ~50 % open, plate fully open — by pinning `__scene` state, screenshot each, and assert the same coverage/gold probes at each pose plus `padCount` reported in the HUD.
- [x] **Step 2: Run** `node verify/render.mjs` → expect the three screenshots saved and assertions PASS.
- [x] **Step 3: Review the three screenshots** and tune only visuals (exposure, gold tint, shadow softness, orbit speed). No structural change here — if a structural fix is needed, it is a new task, not a polish tweak.
- [x] **Step 4: Run** `node verify/unit.mjs` and `node verify/render.mjs` → both PASS.
- [x] **Step 5: Commit** `"tune: exposure, gold tone, shadow softness for showcase look"`.
