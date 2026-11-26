# Nakatomi Plaza - dusk, one take

A single-file WebGL voxel show: every exterior beat of the first hour of *Die
Hard*, played as one continuous camera take outside Nakatomi Plaza. No cuts, no
scene inside the tower - the lens never enters the envelope. Christmas Eve at
dusk: wet ground, warm lobby glow, the storm beat breaking the facade at 360 s.
It runs 735 s and loops.

## Opening it

Open `index.html` in any WebGL-capable browser (Chromium recommended). The page
imports three.js core r0.187.0 from cdnjs, so it needs network the first time;
nothing else loads, and no build step is needed to watch it.

Controls while running: drag orbits, the wheel zooms, `1`..`4` pin one of the
four fixed framings, `space` pauses, `R` restarts. Touching the picture takes the
camera and keeps it: the clock, the sound and the beat labels carry on without
the lens, and `R` hands the lens back to the show (R25). The first click or key press
unlocks sound - the autoplay policy wants a gesture before a page may start
audio, so until then the show is silent and the audio queue keeps walking.

## The show

Twenty-four beats, locked clock: the durations sum to 715 s, `BEAT_END` is 715,
the HOLD runs 20 s more (`SHOW_LEN` 735), the fade starts at 729, and the loop
wraps at 735.25 - one grace-frame past the clamp ceiling - back at the boulevard
pose. The full spec, the batch numbers, and the reasoning live in
[DESIGN.md](DESIGN.md).

| # | beat | HUD label | dur | start |
| - | ---- | --------- | --- | ----- |
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

The camera obeys three rules the gates assert: it never gets inside the tower
envelope (R12/R13), every frame is a dolly from the last - a continuous take,
never a cut (R20), and every beat gets witnessed. The HUD names the beat and
names the lens that painted the frame: the show's own `take`, a numbered framing
while a wide shot holds it, or `your lens` while the mouse does.

The world is about 18.2k voxels drawn as 18,167 splats in one point-sprite
cloud: ground and skyline 9,406 (skyline 2,860 of those), tower core and
curtain wall built at boot, lobby/fountain/tree, 138 dressing cells, 139 roof
cells, 147 convoy cells. The blast/storm overlay is the only thing that draws
over the cloud, in its own 512-point pass - it never touches the shared buffer,
so the wrap restores the facade by construction. The audio queue is 18 events
keyed to the beat table - whomp, crack, siren, glass, engine, room tone under
the HOLD.

## Building and verifying

The page is not hand-written: 14 fragments in `src/NN-*.txt` are joined by
`scripts/build.mjs` into `index.html`, in numeric order. Fragments 01 and 99
open and close the document; the rest are consecutive bodies of that one
module, and no fragment parses on its own.

```powershell
cd projects/nakatomi-plaza
node scripts/build.mjs            # join src/NN-*.txt -> index.html
node scripts/build.mjs --check    # extract the module body and parse-check it
node verify/unit.mjs              # 62 vm-sandbox tests against the built page
node tools/render-gate.mjs index.html   # pixel end-state gates, six named views
node tools/ui-verify.mjs          # drive the full show, assert end state
node tools/lens-check.mjs         # drive the mouse and keys in the real page
```

The last three need the `agent-browser` CLI on `PATH` (it drives a real Chromium
and reads the WebGL back buffer, which the page enables with
`preserveDrawingBuffer: true`). They do not look at a screenshot and hope:
they sample the pixels and assert the rendered end state. `render-gate` walks
six named views - the wide establishing frame, the mid-shaft close-up, the
blast flash and the mid-storm burst at lobby level, the fed convoy's wall of
cars, and the deck at the top of the take - and asserts per view that the voxel
counts are non-zero, the palette gate is clean, the burst frames add shatter-id
pixels over a clean baseline frame, the dusk sky reads exactly `#0a0c12`, the
lens is outside the envelope, and no witness frame is a full-bleed glass fill.
`ui-verify` drives the whole 735 s run frame by frame and asserts the end
state: full black before the cut, exactly one wrap, the hold label on the HUD,
every beat witnessed by the take's own lens, and the whole audio queue fired on
the page side. `lens-check` drives the input, not the picture: a 43 degree drag
and a wheel clamp have to move the lens and keep it while the clock walks, `R`
has to hand the lens back to the take, and a `1`..`4` key has to keep its
framing (R25). Review screenshots land in `ui-verify/` and `render-gate/` -
git-ignored, so they are artefacts, not history.

## Layout

| path | what |
| ---- | ---- |
| `index.html` | the built page - do not edit, build it |
| `src/NN-*.txt` | the fragments, joined in numeric order |
| `scripts/build.mjs` | join + parse-check; `--check` only |
| `verify/unit.mjs` | one suite, `vm` sandbox, THREE stubbed |
| `tools/ui-verify.mjs` | live browser: drive the show, assert end state |
| `tools/render-gate.mjs` | live browser: pixel gates per named view |
| `tools/lens-check.mjs` | live browser: drag, wheel and keys own the lens (R25) |
| `DESIGN.md` | spec, clock, batch numbers, rulings R1-R25 |
| `docs/` | plan and loss record (below) |

## Provenance

This is v2. The v1 build (spec, code, git history) was deleted on 2026-11-24
before any remote existed; the recovery attempt and exactly what was salvaged
is `docs/loss-record.md`. The v1 beat list was unrecoverable, so the table
above is a v2 reconstruction - it keeps the v1 clock constants unchanged
(`BEAT_END` 715, `SHOW_LEN` 735, `FADE_START` 729, storm dur 95, blast at 360)
and the deltas are reviewable. The v1 rulings carried into v2, and everything
decided since - R12 through R25 - is recorded in `DESIGN.md` §3 with the
reasoning. That spec is the contract; this README is the tour.
