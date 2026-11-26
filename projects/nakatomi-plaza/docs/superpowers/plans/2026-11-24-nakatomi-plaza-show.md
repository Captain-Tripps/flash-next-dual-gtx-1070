# Nakatomi Plaza Voxel Show - Implementation Plan (v2 rebuild)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One self-contained `index.html` voxel scene of Nakatomi Plaza at dusk on
Christmas Eve, in which every exterior beat of the first hour of *Die Hard* plays as one
continuous take - camera orbiting and zooming, never inside the tower envelope - then
HOLD, fade to black, loop.

**Architecture:** The scene is authored as numbered fragments under `src/` that are joined
by `scripts/build.mjs` into a single `index.html`. A tiny voxel engine (instanced boxes
from a color palette, `tools/jsp.mjs` exports a splat view of the same buffer) builds the
world: ground contract first, then the tower, then dressings, then FX. A show clock drives
a 24-beat timeline of exact durations; the camera, the FX and the HUD all subscribe to
that clock. Tests are node `vm` unit tests against the built page, plus `tools/render-gate.mjs`
pixel end-state gates and `tools/ui-verify.mjs` drive-to-finish checks.

**Tech stack:** three.js core only (r0.187.0 from cdnjs, the one import), ES modules, node 22
for build/test/gate scripts, `agent-browser` CLI for render gates.

**Spec:** `DESIGN.md` in this folder (v2, re-authored 2026-11-24 after the original was lost;
its rulings and clock values are canonical). Loss provenance:
`docs/loss-record.md` in this folder.

## Global Constraints

- Deliverable: one self-contained `index.html` under `nakatomi-plaza/`. No CDN other than
  cdnjs `three.module.min.js` r0.187.0. No `examples/jsm` imports, no addons, no OrbitControls.
- Camera never enters the tower envelope (Ruling 12/13). Every witness point passes
  `envelope.isOutside(point)` - defined in Task 3, pinned by a test in Task 12.
- Look: dusk on Christmas Eve, wet reflective ground, warm lobby glow through the glass.
- Show clock (exact, from the v1 hand-off notes - these values, not the old doc's start column):
  `BEAT_END = 715`, `HOLD = 20`, `SHOW_LEN = 735`, `FADE_LEN = 6`, `FADE_START = 729`
  (= `SHOW_LEN - FADE_LEN`, last 6 s; NOT the old doc's "719 to 735"), beat durations sum to 715,
  `storm` beat `dur = 95`, `blast` event fires at 360.
- Ruling 14: HOLD at end of show. Ruling 15: storm/blast timing as above. Ruling 16: fade to
  black before the loop cut.
- Fragments are named `NN-slug.txt` and their numeric prefixes are the join order; a fragment
  may only use APIs defined by earlier fragments. Suffix stays `.txt` on purpose: the
  fragments are not standalone modules.
- Audio events subscribe to the clock and must fire at times < 715, or be labelled `hold`.
  Beat labels fall back to the hold text when `beatAt()` returns null.
- Every task ends with tests green, `node scripts/build.mjs --check` clean, commit, and
  `git push` on branch `add-nakatomi-plaza`.

## File Structure

```
nakatomi-plaza/
  index.html                 built artifact, never hand-edited
  DESIGN.md                  the spec (v2)
  README.md                  Task 14
  scripts/build.mjs          Task 1
  tools/jsp.mjs              Task 2  (splat export of the voxel buffer)
  tools/render-gate.mjs      Task 14 (pixel end-state gates, agent-browser)
  tools/ui-verify.mjs        Task 6  (drive-to-finish, AGENTS.md protocol)
  verify/unit.mjs            Task 1, grown per task: vm sandbox + THREE stub
  src/01-shell.txt .. src/14-hud-final.txt   authored fragments, join order
```

## Review Focus

Input classes the spec implies but no task names as a feature; each line gets its test in
the task that owns the code:

1. **A witness point near the curtain wall** - the camera path passes within the glass
   setback at the plaza level. Expected: point still outside the envelope volume. (Task 12.)
2. **A palette index in the reserved range** (`0xe001+`) used by scene geometry.
   Expected: build fails the gate; glass palette entries live at reassigned `0xd001` block
   (the v1 F3 fix, `0xe001` -> `0xd001`). (Task 2.)
3. **A skyline splice shorter than the skyline width** - runs merge +X only, so a partial
   splice leaves a gap column. Expected: no gap; every splice spans full width. (Task 5.)
4. **The clock frame past `SHOW_LEN`** - wrap. Expected: `fade.black === 1` observable before
  the cut; the wrap uses the one-clamp grace window `wrapAt = len + dtClamp`, never a
  double-clamp. (Task 6.)
5. **A beat label queried during the HOLD window [715, 735]** - `beatAt()` returns null.
   Expected: HUD shows the hold text, audio queue is empty of unlabelled events. (Tasks 6, 13.)

---

## Conventions for all tasks

- Run tests with `node verify/unit.mjs` (it exits non-zero on failure; each task's named
  test lives in the `describe` block matching its title).
- The vm harness in `verify/unit.mjs` provides: a stub DOM (style/classList/textContent), a
  `THREE` stub namespace (`Vector3`, `BoxGeometry`, `InstancedMesh`, `Mesh`, `Group`,
  `PerspectiveCamera`, `Scene`, constants), and extracts the inline module from `index.html`
  via `extractInlineModule()`. The fragments must boot clean in that sandbox - no GL, no DOM.
- After every task: `node scripts/build.mjs && node scripts/build.mjs --check &&
  node verify/unit.mjs && git add -A && git commit && git push -u origin add-nakatomi-plaza`.

---

### Task 1: Project scaffold, build, test harness

**Files:**
- Create: `nakatomi-plaza/src/01-shell.txt`, `nakatomi-plaza/scripts/build.mjs`,
  `nakatomi-plaza/verify/unit.mjs`, `nakatomi-plaza/DESIGN.md`, `nakatomi-plaza/.gitignore`
- Test: `nakatomi-plaza/verify/unit.mjs` (first case: "boot is clean")

**Interfaces:**
- Produces: build artifact `index.html` with one inline `<script type="module">`;
  `window.NAKATOMIC` namespace object (fragments attach their APIs to it);
  `verify/unit.mjs` exports `extractInlineModule(html)`, `createSandbox()`,
  `runModuleIn(sandbox)`; `scripts/build.mjs` with `--check` mode.

- [x] Step 1: write `DESIGN.md` (spec v2) - copy the rulings and the exact clock values from
  this plan's Global Constraints plus the Beat Table appendix below, and mark it
  "re-authored after the v1 tree was deleted; beat list is a v2 reconstruction, deltas noted".
- [x] Step 2: write the failing test "boot is clean" in `verify/unit.mjs`: extract inline
  module from a built `index.html`, run it in the sandbox, assert `NAKATOMIC.version` is set
  and no exception thrown.
- [x] Step 3: run `node verify/unit.mjs`; expect FAIL (no index.html / no module).
- [x] Step 4: author `src/01-shell.txt`: `<!DOCTYPE html>` head, HUD divs, `<script type="module">`
  open, import three from cdnjs (exact URL used by dragon-rider-aerie), a `NAKATOMIC`
  bootstrap object with `version: "0.1.0"`, and nothing else.
- [x] Step 5: write `scripts/build.mjs`: read `src/*.txt` in numeric order, join bodies, emit
  `index.html` (head fragment verbatim; closing `</script></body></html>` appended);
  `--check` extracts the module body to a temp file and runs `node --check`.
- [x] Step 6: `node scripts/build.mjs && node scripts/build.mjs --check && node verify/unit.mjs`;
  expect PASS.
- [x] Step 7: commit "nakatomi-plaza: scaffold, build join, vm test harness"; push branch.

### Task 2: Voxel engine + palette contract (`tools/jsp.mjs`)

**Files:**
- Create: `nakatomi-plaza/src/02-voxels-palette.txt`, `nakatomi-plaza/tools/jsp.mjs`
- Test: `verify/unit.mjs` describe "voxel contract": `addRun` merge, palette gate test.

**Interfaces:**
- Consumes: `NAKATOMIC` from Task 1.
- Produces: `NAKATOMIC.vox = { addRun(x0, y0, z0, len, paletteId), addStack(x0, y0, z0,
  height, paletteId), count, bounds()}`; runs merge in +X only; `NAKATOMIC.palette = {
  define(id, hex), id(hex), gate() }`; palette ids below `0xd001` are scene-owned, range
  `0xe001`+ reserved, and `gate()` throws listing every offender. Nakatomi glass entries
  occupy the reassigned `0xd001` block (v1 F3 fix).

- [x] Step 1: failing test "addRun merges +X into one run": add two overlapping +X runs,
  assert `count` is the merged total and `bounds()` covers both ends.
- [x] Step 2: failing test "gate rejects reserved-range ids": a palette entry at `0xe001`
  used by geometry makes `gate()` throw.
- [x] Step 3: run; expect FAIL.
- [x] Step 4: implement `src/02-voxels-palette.txt` per Interfaces; `tools/jsp.mjs` exports
  `toSplats(voxBuffer)` returning `{ points, colors }` from the same buffer (used by Task 14
  pixel gates).
- [x] Step 5: run; expect PASS. Commit: "voxel run merge + palette gate (0xd001 glass block)".

### Task 3: Tower core + envelope contract

**Files:**
- Create: `src/03-tower-core.txt`; modify `01-shell.txt` only if the HUD needs a stats line.
- Test: "tower is solid and bounded", "envelope encloses the glass line".

**Interfaces:**
- Produces: `NAKATOMIC.envelope = { min, max, isOutside(point), radius }` - the outer
  curtain-wall volume including the setback skirt; `NAKATOMIC.tower = { built, height }`.

- [x] Step 1: failing test "tower is solid and bounded": after boot, `tower.built` true,
  `height > 0`, every voxel inside `bounds()`.
- [x] Step 2: failing test "envelope encloses the glass line": a known glass-line corner is
  NOT outside; a point 4 m beyond is outside.
- [x] Step 3: run; expect FAIL.
- [x] Step 4: implement the tower core as stacked `addStack`/`addRun` volumes: plaza podium,
  42-story shaft, the 25-35 setback, roof mechanical penthouse. Envelope = shaft footprint +
  full-height skirt around the podium, 2 m clear of the glass line.
- [x] Step 5: run; PASS. Commit: "tower core + outside-envelope contract".

### Task 4: Curtain wall + glow layer

**Files:** Create: `src/04-curtain-wall.txt`.
- Test: "glass ids in 0xd001 block, none reserved"; "mullion density".

**Interfaces:**
- Consumes: `palette.define` from Task 2, `envelope` from Task 3.
- Produces: `NAKATOMIC.glass = { cells, litFraction, lit(id) }` where `lit()` marks lobby glow
  (lower floors warm-lit, upper floors dark at dusk except the few lit for the finale).

- [x] Steps 1-5: failing tests for both names (glass palette ids pass `gate()`;
  `litFraction` between 0.55 and 0.75 at dusk - spec Ruling: "most dark, lobby bright");
  implement glazing as thin runs on the shaft faces, glow handled as a separate additive
  layer that Task 14's render gate samples; PASS; commit.

### Task 5: Ground contract - garage, ditch, plaza, palms, skyline

**Files:** Create: `src/05-ground-plaza.txt`.
- Test: the v1 ground-contract test, re-pinned to the recovered values.

**Interfaces:**
- Consumes: `vox`, `palette`.
- Produces: `NAKATOMIC.ground()` returns exactly
  `{ voxels, batchVox, countVox, bounds, garageVolume, ditchVolume, plazaVolume,
  waterVolume, palmCount, skylineCount, streetY }`, plus `NAKATOMIC.isOnGround(x, z)`;
  locked: `countVox === 9406`, `skylineCount === 2860` (~30.4% of `countVox`).

- [x] Step 1: failing test "ground() shape and locked numbers": asserts the exact return
  keys, `countVox` 9406, `skylineCount` 2860, `isOnGround` true inside the lot, false beyond
  the boulevard. These are the v1 verified numbers; tune the geometry (splice widths, palm
  placement) until the counts match, and keep the numbers as the invariant - the test drives
  them, they are not a starting point to drift away from.
- [x] Step 2: failing test "skyline splices are full width": every horizontal splice spans
  the whole skyline width (no gap column; runs merge +X only).
- [x] Step 3: run; expect FAIL.
- [x] Step 4: implement: sunken garage lot (its volume), the sunken driveway/ditch and bridge
  over it, the entry plaza with fountain (`waterVolume` > 0), palm grove along the
  boulevard (`palmCount` 12), distant skyline as full-width horizontal splices.
- [x] Step 5: run; PASS. Commit: "ground contract, 9406 vox, full-width skyline splices".

### Task 6: Show clock - beats, HOLD, fade, wrap

**Files:** Create: `src/06-clock-beats.txt`, `tools/ui-verify.mjs`.
- Test: the recovered v1 clock numbers, re-pinned.

**Interfaces:**
- Consumes: `NAKATOMIC`.
- Produces: `NAKATOMIC.clock = { BEATS, order, start(id), dur(id), seekTo(id), beatAt(t),
  len, BEAT_END, HOLD, SHOW_LEN, FADE_START, FADE_LEN, fade, wrapAt, tick(dt) }`;
  `BEATS` exactly as the Beat Table appendix below (durations sum to 715);
  `seekTo("blast")` == 360; `beatAt()` returns null in [715, 735);
  `fade.black` ramps 0 -> 1 over [FADE_START, SHOW_LEN]; wrap = one-clamp grace:
  `wrapAt = SHOW_LEN + dtClamp` and after `wrapAt` the clock resets to 0 exactly once.

- [x] Step 1: failing test "BEATS literal equals the Beat Table": `clock.BEATS` is the 24
  rows of Appendix A in order, with exact durations and cumulative `storm` start == 390
  (the arithmetic of the appendix is then pinned by a test, not by prose).
- [x] Step 2: failing test "clock constants": sums 715, 735/20/6/729, storm dur 95,
  `seekTo("blast")` 360.
- [x] Step 3: failing test "hold and fade and wrap": `beatAt(730)` null; `fade.black === 1`
  before the cut; exactly one reset when ticking past `SHOW_LEN + dtClamp`; no second clamp.
- [x] Step 4: failing test "fade observable at FADE_START" (Review Focus 4).
- [x] Step 5: run; expect FAIL.
- [x] Step 6: implement the clock fragment per Interfaces; `tools/ui-verify.mjs` = the
  AGENTS.md `ui-verify` core adapted: open page, `NAKATOMIC.clock.seekTo("blast")`, assert
  rendered end state later. (End-state assertion, not symptom probes.)
- [x] Step 7: run unit; PASS. Commit: "show clock: 715/735, hold, fade, one-clamp wrap".

### Task 7.5: Scene assembly - first pixels (R18 pulled forward)

**Files:** Create: `src/99-scene-render.txt`; modify `src/05-ground-plaza.txt` (idempotent
`ground()`); modify `tools/ui-verify.mjs` (scene assertions). Jon chose this order on
2026-11-25: the plan had no scene-assembly task (R18) and the page drew nothing, so the
wiring moves ahead of the content tasks so Tasks 7-12 land visibly.

**Interfaces:**
- Consumes: `vox.buffer()` (`{ runs, hexOf }`), `palette`, `clock`, `NAKATOMIC.ground()`.
- Produces: `NAKATOMIC.splats(bufferView) -> { points, colors }` (the page-side twin of
  `tools/jsp.mjs`, no THREE, so it tests in the sandbox); `NAKATOMIC.scene = { start,
  rebuild, running, stats: { points, voxels, fps }, camera, fov, framing, setFraming,
  togglePause, restart, gl }`; `NAKATOMIC.ensureWorld()` - every fragment's geometry
  emitted into the shared buffer exactly once.
- The fragment joins last on purpose (`99-` prefix): the world must be complete before the
  scene reads the buffer.

- [x] Step 1: failing test "ground() is idempotent": two calls emit the world once, so
  `vox.count` does not double and `countVox` is unchanged (today `put` calls `addRun`
  unconditionally, which is the latent bug a render loop would hit).
- [x] Step 2: failing test "page-side splats mirror the buffer": `splats(vox.buffer())`
  emits one point per voxel and every colour resolves through the palette; totals equal
  ground + tower, not a half-buffer.
- [x] Step 3: failing test "the scene exposes its contract": `NAKATOMIC.scene` keys pinned,
  and boot stays clean in the sandbox - the fragment touches no DOM or GL at eval time.
- [x] Step 4: implement `src/99-scene-render.txt`: renderer with `preserveDrawingBuffer`,
  THREE.Points from the splat arrays, hand-rolled orbit (drag/wheel, no addons), framings
  1..4, space pause, R restart, HUD from `beatAt()` with the hold fallback, `#fade` opacity
  from `clock.fade.black`, and the rAF loop that calls `clock.tick` exactly once per frame.
- [x] Step 5: extend `tools/ui-verify.mjs` with the pixel end state: canvas exists,
  `scene.stats.points === vox.count`, and the centre of the frame is not the background
  colour (the tower is on screen), then screenshot it for review.
- [x] Step 6: run unit + ui-verify; PASS. Commit: "scene assembly: first pixels, orbit rig, HUD/fade wiring".

### Task 7: Lobby, fountain, Christmas tree - seen through glass

**Files:** Create: `src/07-lobby-fountain-tree.txt`.
- Test: "tree inside the glass line, on ground", "fountain volume above water line".

**Interfaces:**
- Consumes: `envelope.isOutside` (tree must NOT be outside - it is inside the envelope,
  behind glass), `ground().waterVolume`, `glass.lit`.

- [x] Steps 1-5: failing tests (tree is a voxel volume inside the envelope and on ground;
  fountain water voxels coincide with `waterVolume`); implement; PASS; commit. The live
  pixel gate (`tools/ui-verify.mjs`) is part of Step 5 from Task 7.5 onward: the lobby,
  tree and fountain have to be in the end-state frame, not just in the buffer.

### Task 8: Plaza dressings - taxis, limo, tree truck, lights, marquee

**Files:** Create: `src/08-plaza-dressing.txt`.
- Test: "dressings are on ground and outside envelope"; "arrival lanes clear palms".

- [ ] Steps 1-5: failing tests (every dressing volume is on ground and not inside the
  envelope; arrival lane voxels don't intersect `palmCount` columns); implement vehicles and
  walkway dressing volumes; PASS; commit.

### Task 9: Roof gun-run, tile helo, glass-break

**Files:** Create: `src/09-roof-gunrun.txt`.
- Test: "run stacks on roof, none inside envelope", "tile helo stays above envelope".

- [x] Steps 1-5: failing tests (stacked run voxels sit on the roof line, inside the tower
  bounds; the tile-helo volume never below roof height); implement; PASS; commit.

### Task 10: Blast + storm - glass facade break, shatter burst

**Files:** Create: `src/10-blast-storm.txt`.
- Test: "blast at 360, storm dur 95, shatter outside envelope after 365".

- [x] Step 1: failing test "blast timing pins v1": `seekTo("blast")` 360, storm dur 95,
  shatter voxels for the storm beat only exist for t in [360, 360+95). (The literal
  window here is a slip: the storm beat opens at 390, so the shatter spans [390, 485) -
  read from `clock.start("storm")`/`clock.dur("storm")`, not a hand-kept number. See R15.)
- [x] Step 2: failing test "facade break leaves the envelope": broken glass voxels drift
  outside the envelope after the blast and restore on the wrap.
- [x] Step 3: run; expect FAIL.
- [x] Step 4: implement blast volume + shatter burst + the curtain-wall break (glass ids
  swap to dark-shatter ids inside the storm window only).
- [x] Step 5: run; PASS. Commit: "blast@360 + storm(95) glass-break shatter".

### Task 11: Police convoy + fed arrival

**Files:** Create: `src/11-convoy-feds.txt`.
- Test: "conv route follows boulevard, never inside envelope".

- [x] Steps 1-5: failing test (the convoy path sampled 20 points deep - every one either
  `isOnGround` or outside the envelope); implement the convoy path (boulevard, driveway
  loop, black-and-wipe position); PASS; commit.

  What shipped differs in one respect and one typo: the batch is **staged once, statically**
  (R19), so the convoy is world geometry that stands from t=0 and the `fedConvoy`/`wallOfCars`
  windows carry camera interest and HUD labels rather than new geometry. The plan's
  "black-and-wipe" is the *lead car* - the black-and-white that took the ramp into the sunken
  driveway under the bridge, parked at `x -6..-3, z -19` two bands below street level. Route is
  17 axis-aligned waypoints, which Task 12's pull-back consumes directly (a diagonal leg once
  cut the skirt's corner at `-20,0,-18`). 147 cells, 90 body / 48 band / 9 light-bar parts, 9
  FCPD cruisers in two rows, 3 fed SUVs, 13 cars, 18 light-bar cells (10 red / 8 blue). Screen
  proof is the two lightbar hexes themselves - the only saturated red and saturated blue in the
  dusk palette - 170 responder-light pixels from two legal witness lenses, `stats.fx` 0 through
  the fed beats. Commit: "police convoy + fed arrival".

### Task 12: Camera rig - continuous take, outside only

**Files:** Create: `src/12-camera-rig.txt`.
- Test: "every witness point passes isOutside" (Review Focus 1); "paths follow beat order".

**Interfaces:**
- Consumes: `clock.order`, `envelope.isOutside`, `NAKATOMIC.ground().streetY`.
- Produces: `NAKATOMIC.rig = { keys(id) -> [ {t, pos, target, fov} ], sample(id, t) }`;
  continuous single take: keys interpolate; never teleports; `fov` clamped 35..60.

- [x] Step 1: failing test "every witness point passes isOutside": for each beat, sample 12
  t-values across its key path and assert every position is outside the envelope, including
  the glass-line-proximity key (a key deliberately at 3.5 m from the curtain wall at plaza
  level must still satisfy the test - Review Focus 1).
- [x] Step 2: failing test "rig follows the beat order and never teleports": consecutive
  samples are within epsilon of the interpolated path.
- [x] Step 3: run; expect FAIL.
- [x] Step 4: implement the rig: a per-beat key table over the Beat Table, orbiting the
  tower, with zooms on the blast beat and a boulevard pull-back for the convoy.
- [x] Step 5: run; PASS. Commit: "single outside take: per-beat camera keys + invariant".

### Task 13: Audio events + HUD beat labels

**Files:** Create: `src/13-audio-hud.txt`.
- Test: "audio events < 715 or hold-labelled"; "HUD label null fallback" (Review Focus 5).

- [x] Step 1: failing test "no event fires in the hold window without a hold label":
  enumerate the registered queue; every entry `t < 715` or carries `hold: true`.
- [x] Step 2: failing test "HUD null beat label falls back to hold text".
- [x] Step 3: run; expect FAIL.
- [x] Step 4: implement WebAudio event synth (helo whomp, blast crack, sirens) keyed to
  `clock.order`, and the HUD text driven by `beatAt()` with the hold fallback.
- [x] Step 5: run; PASS. Commit: "show audio queue + hold-fallback beat labels".

### Task 14: Final pass - README, render gate, full show run

**Files:** Create: `README.md`, `tools/render-gate.mjs`; modify `01-shell.txt` (stats line).
- Test: the render-gate run itself (pixel end state per framing).

- [ ] Step 1: write `README.md` (what it is, how to open it, the beat list, the clock
  values, provenance note pointing at DESIGN.md and the loss record).
- [ ] Step 2: write `tools/render-gate.mjs` (copy the dragon-rider gate pattern): load
  `index.html`, seek to 5 named framings via `clock.seekTo`, assert per view: voxel count
  > 0, palette gate clean, blast-frame pixels contain the shatter id, dusk sky colour match,
  envelope never breached (camera witness screenshot must not be a full-bleed glass fill).
- [ ] Step 3: run `node tools/render-gate.mjs index.html`; expect PASS, fix any failure.
- [ ] Step 4: run `node tools/ui-verify.mjs`; expect the end state after the full 735 s run:
  `fade.black === 1`, HUD hold text, one wrap, vox totals = ground+tower totals.
- [ ] Step 5: full suite: `node scripts/build.mjs --check && node verify/unit.mjs &&
  node tools/render-gate.mjs index.html && node tools/ui-verify.mjs`; expect PASS.
- [ ] Step 6: commit "nakatomi-plaza: full show render-gated"; push; open PR to `main`
  (Jon merges - no merges by agents).

---

## Appendix A: Beat Table (v2 reconstruction - locked)

v1's beat list is unrecoverable; this v2 table keeps scene order and the exact v1 clock
constants (`BEAT_END = 715`, `HOLD = 20`, `SHOW_LEN = 735`, `FADE_START = 729`, storm dur
95, storm/blast cumulative 360). Deltas are Jon-reviewable.

Verified in code against the v1 hand-off numbers: 24 beats, durations sum to 715, the
`blast` beat starts at 360 (`seekTo("blast") == 360`, the locked v1 invariant), `storm`
runs 390 to 485 (dur 95, it absorbs the slack), `BEAT_END = 715`, `SHOW_LEN = 735`.

| # | id | label (HUD) | dur | start |
| - | -- | ----------- | --- | ----- |
| 1 | `open` | Dusk over the boulevard - establishing | 34 | 0 |
| 2 | `taxiConvoy` | Taxi convoy onto the lot | 38 | 34 |
| 3 | `horseCar` | Horse car and motorcycle escort | 33 | 72 |
| 4 | `limoNakatomi` | Nakatomi Plaza signage, glass lobby | 38 | 105 |
| 5 | `treeTruck` | Christmas tree truck, light trucks | 36 | 143 |
| 6 | `archWalk` | Walkway, palms, marquee | 35 | 179 |
| 7 | `treeSet` | Tree set down beneath the glass | 34 | 214 |
| 8 | `skateHolly` | Holly on skates to the doors | 32 | 248 |
| 9 | `gunRun` | Gun run staged on the roof | 38 | 280 |
| 10 | `tileHelo` | Tile helo - the whomp | 42 | 318 |
| 11 | `blast` | Blast - first facade break (starts at 360) | 30 | 360 |
| 12 | `storm` | Storm over the skyline (dur 95) | 95 | 390 |
| 13 | `fedConvoy` | Fed convoys up the boulevard | 42 | 485 |
| 14 | `wallOfCars` | Wall of police cars on the lot | 36 | 527 |
| 15 | `lobbyLights` | Lobby lights hold under dusk | 34 | 563 |
| 16 | `carDepart` | Cars off the lot at dusk pull-back | 22 | 597 |
| 17 | `treeGlow` | Tree glow, canopy shimmer | 18 | 619 |
| 18 | `fountainSettle` | Fountain settles, water still | 15 | 637 |
| 19 | `plazaWide` | Plaza wide, empty walkway | 13 | 652 |
| 20 | `skyPush1` | Skyline push-in 1 | 11 | 665 |
| 21 | `skyPush2` | Skyline push-in 2 | 10 | 676 |
| 22 | `towerPull` | Tower pull-back to boulevard | 9 | 686 |
| 23 | `rooftopGlow` | Rooftop glow, penthouse lights | 8 | 695 |
| 24 | `drestle` | Final settling frame before the hold | 12 | 703 |

Sum of the 24 durations = 715; `HOLD` 20; `SHOW_LEN` 735; `FADE_START` 729.
