# Nakatomi Plaza - voxel show (spec v2)

One self-contained `index.html`: Nakatomi Plaza at dusk on Christmas Eve, built from
voxels, in which every exterior beat of the first hour of *Die Hard* plays as one
continuous camera take. The camera orbits and zooms; it never enters the tower envelope.
After the last beat the show HOLDS, fades to black, and loops.

This spec is v2, re-authored 2026-11-24. The v1 tree (spec, code, and git history) was
deleted from disk on 2026-11-24 between 22:00 and 22:12 local and was never in the cloud;
see `docs/loss-record.md`. The v1 beat list was unrecoverable, so Appendix B is a v2
reconstruction that carries the v1 clock constants unchanged.

## 1. The scene

| Element | What it is |
| --- | --- |
| Tower | 42-story glass shaft on a podium, 25-35 setback, roof mechanical penthouse |
| Curtain wall | thin glass runs on all four shaft faces, warm lobby glow through the lower floors |
| Ground | sunken parking lot, sunken driveway/ditch with the bridge over it, entry plaza, fountain |
| Dressing | palm grove (12), taxis, limo, Christmas-tree truck, light trucks, marquee, walkway |
| Skyline | distant city blocks, built as full-width horizontal splices |
| FX | roof gun-run staging, tile helicopter, blast, glass-break shatter, police convoy |

Look: dusk, wet reflective ground, low cloud, most floors dark, lobby bright.

## 2. The show clock (locked, from v1)

```
BEAT_END   = 715    sum of the 24 beat durations
HOLD       = 20     beats stop, the frame holds
SHOW_LEN   = 735    = BEAT_END + HOLD
FADE_LEN   = 6
FADE_START = 729    = SHOW_LEN - FADE_LEN   (the last 6 seconds, not "719 to 735")
storm dur  = 95     absorbs the slack
blast      = 360    the blast beat starts at cumulative 360; seekTo("blast") === 360
```

`beatAt(t)` returns `null` for `t` in [715, 735) - the HUD falls back to the hold text.
Audio events fire at `t < 715` or carry `hold: true`. The wrap uses one clamp: after
`SHOW_LEN + dtClamp` the clock resets to 0 exactly once; `fade.black === 1` is observable
before that cut. Timings are derived with `seekTo(id)`, never from a start column.

## 3. Rulings (v1, carried into v2)

- **R12/13 - the camera is outside.** No witness point may sit inside the tower envelope.
  The envelope is the shaft footprint plus a skirt around the podium, 2 m clear of the
  glass line; its top is the roof deck, so a camera over the roof is outside by definition.
- **R14 - HOLD.** Twenty seconds of still frame at the end of the show.
- **R15 - storm/blast timing.** The blast beat starts at 360; `storm` follows with dur 95;
  the glass-break shatter lives inside that window and restores on the wrap. The window
  is read from the clock (`clock.start("storm")` and `clock.dur("storm")`), never a
  hand-kept number: the plan's literal `[360, 360+95)` is a slip, because the storm beat
  it names opens at 360+30 = 390. The shatter spans **[390, 485)** - the storm beat's own
  span. The blast flash is a separate window over the blast beat, **[360, 390)**.
  "Restores on the wrap" is mechanical, not a restore path: the overlay never writes the
  shared voxel buffer, so every base cell keeps the colour it had before the window
  opened, and outside the window the overlay answers "nothing".
- **R16 - fade to black before the loop cut.** Not a hard cut to the next loop.
- **R17 - two glazing numbers, not one.** The plan's sentence "litFraction between
  0.55 and 0.75 at dusk - most dark, lobby bright" pins one count two ways, which a
  single number can not satisfy. `glass.litFraction` is the glazing coverage of the
  facade ring, pinned in 0.55..0.75 exactly as the plan asks; the look it names is
  `glass.litShare`, the share of glazed cells that glow from inside, pinned well
  under a half - arcade and atrium bright, upper bands dark at dusk.
- **Glass palette block.** Curtain-wall and shatter ids live in the reassigned `0xd001`
  block (v1 fix F3, `0xe001` -> `0xd001`). `0xe001` and above is reserved and the palette
  gate rejects any geometry that uses it.
- **R18 - the plan has no scene-assembly task, so the loop has one home.** No task in the
  plan creates the page's render loop (renderer, `THREE.Points` from the buffer, the rAF
  loop that calls `clock.tick`, the camera, and the HUD/fade elements), yet Task 14's
  render gate needs pixels. Jon pulled that wiring forward as **Task 7.5** on 2026-11-25,
  so Tasks 7-12 land visibly instead of blind: `src/99-scene-render.txt` owns the renderer,
  the orbit stand-in for the camera, `NAKATOMIC.ensureWorld`/`NAKATOMIC.splats`, and the
  HUD/fade wiring. Task 12's rig then drives it through `scene.setPose`, and nothing in
  Tasks 7-12 may add a renderer of its own.
- **R19 - the response is staged, not driven in.** The police convoy, the fed SUVs and the
  lead car are one static batch, parked in their wall from `t = 0` for the whole show. The
  show is a single continuous outside take (R12/R13) and a vehicle arriving mid-show would
  need a cut to look believable, so the `fedConvoy` and `wallOfCars` beat windows carry the
  camera's interest and the HUD label, not new geometry. The route that the convoy would
  have driven is still published (`convoy.route`, `convoy.routeAt`) as the data layer
  Task 12's boulevard pull-back walks along. Because the batch never moves, its screen
  proof in `tools/ui-verify.mjs` can not be a frame delta: it is the two lightbar palette
  ids landing on the sensor, the only saturated red and saturated blue in the dusk palette.
- **R20 - the take is one master key track, and the gates check different things.**
  `rig.allKeys` is one array of `{ t, id }` interpolated pairs over absolute show times: one
  continuous take (R12/R13), so a beat's own leg ends exactly where the next one starts, and
  the take's last key is its first key (30, 40, 60) so the wrap cuts to black back at the
  boulevard pose (R18). Keys are strictly increasing in time, fov is clamped to 35..60 at
  build time, and there are no zoom lenses in the take.
  The two witness gates check different things on purpose. The fragment's own build-time gate
  walks the **key endpoints** and `envelope.isOutside`; the unit tests sample **interpolated
  segments**, and the live driver walks the frames the page actually renders. Endpoint checks
  alone pass a straight diagonal that clips the shaft's corner between two legal keys - the
  lower shaft's shell stands at x/z +-14 (shaft +-12 plus the 2 m skirt), boundary-exclusive,
  so a diagonal across a corner is legal at its ends and inside the middle of its leg. Three
  legs in the take are therefore L-shaped around the shaft: the glass-line approach via
  (16.5, 5.5, 20), the blast descent down the NE corner via (16, 47, -15), and the plazaWide
  exit west via (-15, 6, -24). The sampled-segment test is the one that catches a shell
  crossing; the endpoint gate is only the cheap first pass.
  `scene.cameraSource` tells the HUD and the screenshots which of the three cameras painted a
  frame - `take` (the rig, claimed only by `step()` with a live beat to key), `lens` (a pose a
  tool pinned) or `framing` (one of the four orbit wide shots). A review screenshot that says
  `framing 3/4` while the take drives the lens is a screenshot that lies about itself.
- **R21 - the audio queue is data, and the HOLD is audible.** The queue is built from
  beat offsets at build time (`clock.start(id) + off`), never hand-kept times, and the
  plan's invariant (Review Focus 5) is enforced both ways: an entry that sounds from
  `BEAT_END` on must carry `hold: true`, and an entry carrying it before there is
  rejected. Because the queue is data, the gate walks the whole show with no browser and
  no AudioContext; the context exists only after a user gesture (the autoplay policy
  decides this, not the code), and `pump` counts frame crossings even with no context.
  The live driver then asserts that one full take fires every queued entry on the page
  side - a page-side audio that only ever got read from the Node side is the failure this
  catches. The HUD's label rule (null beat → `HOLD_LABEL`) lives in this fragment and the
  scene's `label()` defers to it, so the page's label and the HUD's cannot drift apart.
- **R22 - the render gate proves pixels, not counters.** `tools/render-gate.mjs` freezes six
  named views with `setFraming`/`setPose` and reads the back buffer, because the full-take run
  can not say whether a burst actually landed on the screen. Three consequences worth their
  measurement: the dusk-sky bar compares the bytes the clear colour *arrives* as (`#0a0c12`
  unchanged - no dither, no encode on the sky rows) rather than the constant the page starts
  from; the shatter overlay is counted with a strict near-white signature against a same-lens
  baseline frame (`pale` 0 at t=359 against 50 at 365 and 46 at 437), because the loose cool
  signature runs ~700 in a quiet lobby frame - AA on lit glass reads cool too; and the two fx
  views sit at lobby level rather than the mid-shaft framing, because the break lives at
  storey bands 5..8 on the atrium face (`S.z0`) and framing 2 aims past it (measured `pale` 4
  both inside and outside the window). The gate also asserts that no witness frame is a
  full-bleed content fill: R12's breach would be exactly that.
- **R23 - a published member only earns its keep if a test names it.** The rig's §5 row was
  the only contract row that nothing checked: `unit.mjs` asked whether `rig.keys` and
  `rig.sample` were functions, and the row went on describing `allKeys`, the `id` argument
  of `sample`, and three `routeKeys` waypoints that no code existed. The surface is now
  pinned member for member the way the scene's row is, which is how the stale claims were
  found: `sample(id, t)` ignored its `id` and could pull a pose from the next beat early,
  `allKeys` was never published, and `routeKeys` is seven arc samples of `convoy.routeAt`
  across one beat, not three waypoints and not a leg the take drives. Two rules came out of
  the fix, not the patch: a §5 row states what the code does, so when a row describes an API
  the code never built the row moves, not the implementation to match paper; and the loop
  home is a **pose**, not a time - the take's last key is its first key pose for pose at the
  end of `drestle` (t 713.2), and `push()`'s own gate proves the final pose equals the
  opening pose. Adding a key at `BEAT_END` would have made the lens dolly home in zero time
  and given the sampled-segment gates a leg nobody measured.
- **R24 - the page boots itself, and a tool that boots it for the page is not a gate.** Jon
  opened `index.html` and got the static shell: black stage, foot menu only. The probe said
  why without an error to read - `NAKATOMIC` assembled, `scene.running` false, no canvas, and
  `start()` worked when called by hand. Nothing in the page ever called it. Both live tools
  called `N.scene.start()` on the page's behalf, which is exactly how a page that never boots
  kept testing green in six views and a full take. The boot now hangs on the document's own
  `DOMContentLoaded`: eval time still touches no DOM and no GL (the vm stub records the hook
  and never fires it), and `unit.mjs` fires it by hand to prove the hook is the whole boot -
  one canvas, 18167 splats, the opening label on the HUD. `render-gate.mjs` and `ui-verify.mjs`
  now fail with "the page never booted itself" rather than starting the show themselves. The
  rule: a gate that performs the thing it claims to check has stopped checking it.
- **Fade completes one grace-frame early.** `fade.black` reaches exactly 1 at
  `FADE_START + FADE_LEN - dtClamp`, inside the fade window, so the full-black frame is
  rendered before `SHOW_LEN` rather at its boundary; the loop cut then waits for the grace
  frame at `SHOW_LEN + dtClamp` (R16 needs a visible black frame, not a swallowed one).

## 4. Canonical dimensions (set here, consumed by every later task)

Voxel scale: 1 unit horizontally = 1 m; 1 unit vertically = one storey band
(~3.7 m floor-to-floor), so the curtain wall reads as stacked storey bands, the
way the real plaza does. Street level (`streetY`) is y = 0.

| Feature | x | z | y bands |
| --- | --- | --- | --- |
| Block (plaza + boulevard) | -43..43 | -31..30 | paving deck y = -1, street level y = 0 |
| Sunken garage lot | -15..15 | -31..-21 | floor y = -6, retaining walls y = -5..-1 |
| Sunken driveway (ditch) + bridge | -22..22 | -20..-18 | floor y = -3, walls y = -2..-1, bridge deck y = 0 |
| Reflecting pool | -5..5 | 25..27 | basin band y = -1, water flush y = 0 |
| Arrival court (dressing lane) | -20..20 | 20..24 | vehicles y = 0..1, marquee posts y = 0..2, beam y = 3 |
| Police convoy wall (Task 11) | -21..21 | 20..23 | bodies y = 0..1, lightbars y = 2 |
| Fed SUVs, boulevard side | 25..39 | -16..-15 | bodies y = 0..1, lightbars y = 2 |
| Lead car, sunken driveway | -6..-3 | -19 | body y = -2, cabin y = -1, marker y = -2 |
| Palm grove (12) | 24/30/36 and mirrored | -25 and 25 | trunk y = 0..3, canopy y = 4 |
| Distant skyline (3 walls) | -55..54 | z = 44, 56, 70 | full-width splices, 6 + 12 + 8 bands |
| Podium (arcade + lobby) | -20..20 | -17..17 | 0..3 (arcade rows 0..2, deck slab row 3) |
| Shaft, lower (storeys 1-24) | -12..12 | -12..12 | 4..27 |
| Shaft, setback band (storeys 25-35) | -10..10 | -10..10 | 28..38 |
| Shaft, upper (storeys 36-42) | -11..11 | -11..11 | 39..45 |
| Roof deck | - | - | y = 46 |
| Roof mechanical penthouse | -9..9 | -9..9 | 47..49 |

Curtain wall: one grid over every band face - a mullion column every third cell of
each face, corner posts on every row so the two face rules agree at the corner -
and glass in the bays between. The facade ring stays fully claimed and no cell is
claimed by two palette ids.

Lobby, fountain, tree (Task 7): everything in the arcade band, and none of it on the
glass line or the deck slab. The lobby's interior rectangle is the podium footprint
shrunk by one cell - `-19..19` by `-16..16`, bands `0..2`, with the deck slab at y = 3
over it - and the lit lobby wall sits on that rectangle's edge, one cell behind the
curtain wall, so the arcade glow has depth instead of being a bright sheet on the glass
plane. The tree stands at `(8, 14)`: a 5x5 foot at y = 0, a 3x3 one band up, and the
star cell at y = 2, all of it under the deck. The fountain reports the ground's water
(the reflecting pool at `-5..5` / `25..27`, 33 voxels at the water line) and puts its
own coping at y = 1, stem and basin at y = 2 and the jet at y = 3 - none of it re-claims
a water cell.

Envelope (R12/13): the outer box is the podium footprint plus a 2 m skirt,
`min = (-22, 0, -19)` to `max = (22, 46, 19)`, and its top is the roof deck, which
makes a camera over the roof outside by definition. But `isOutside` is not that
box: it follows the building band by band (`envelope.profile`), each band offset
2 m clear of the facade at that height - the podium is wider than the shaft it
carries, so a single box would let a camera sit on the glass. `radius` is the
bounding-sphere radius about the envelope centre.

## 5. The contract that tests pin

- `NAKATOMIC.vox` - `addRun`/`addStack`/`count`/`bounds`, runs merge in +X only.
- `NAKATOMIC.palette` - `define`/`id`/`gate()`; `gate()` throws listing every offender.
- `NAKATOMIC.envelope` - `min`/`max`/`profile`/`isOutside(point)`/`radius`.
- `NAKATOMIC.glass` - `cells` (each `{ x, y, z, id, lit }`)/`ids` (`dark`, `lit`,
  `shatter`, pinned in the `0xd001` block)/`facadeCells`/`litFraction` (glazing
  coverage of the facade ring)/`litShare` (the dusk rule)/`litCount`/`lit(id)`.
- `NAKATOMIC.ground()` - exactly `{ voxels, batchVox, countVox, bounds, garageVolume,
  ditchVolume, plazaVolume, waterVolume, palmCount, skylineCount, streetY }`, with
  `countVox === 9406` and `skylineCount === 2860` (30.4 % of the ground batch), plus
  `NAKATOMIC.isOnGround(x, z)`. Volumes are voxel bands, not masonry; `countVox`
  counts a cell once, so a feature claimed by two ids throws.
- `NAKATOMIC.skyline` - `x0`/`x1`/`walls`/`ids`; every skyline splice spans
  `x0..x1` (110 columns), because the run buffer only merges in +X.
- `NAKATOMIC.clock` - `BEATS`/`order`/`start(id)`/`dur(id)`/`seekTo(id)`/`beatAt(t)`/`len`/
  `BEAT_END`/`HOLD`/`SHOW_LEN`/`FADE_START`/`FADE_LEN`/`fade`/`wrapAt`/`tick(dt)`; also
  `dtClamp` (the one-frame grace, 0.25 s), `HOLD_LABEL` (what the HUD shows through the
  hold), `restart()`, and the getter `t`. `tick(dt)` returns
  `{ t, beat, black, wrapped }` so the render loop reads the frame from one object.
  The 24 rows are Appendix B verbatim and one test compares them whole.
- `NAKATOMIC.rig` - the single outside take (R20): `all()` (the flat master key list as
  `{ t, pos, target, fov }`, absolute show times, in beat order - the `[ frac, pos,
  target, fov ]` form is the internal row `beat()` takes, not what this returns),
  `allKeys` (the same track as `[{ t, id }]`, each key stamped with the beat the clock
  puts it in, strictly increasing), `keys(id)` (that beat's slice, times absolute),
  `sample(id, t)` (linear interpolation along the master, clamped to the named beat's own
  window, so a time past a beat can not pull that beat's exit pose from the next one),
  and `routeKeys(id)` (seven arc samples of `convoy.routeAt` spread across one beat: the
  fed beats' witness layer, the same route the batch stands on at t = 0 - not a leg the
  take drives (R19)). Every leg is the pair that starts at that key's `t`, so a
  segment's start is exactly the previous key's pose and the take never cuts. Build-time
  gates: the keys are strictly increasing, fov stays in 35..60, the last key is the first
  key pose for pose, and every key endpoint passes `envelope.isOutside` - the unit tests
  and the live driver check the sampled segments, which is the stronger pair (R20). Every
  absolute time comes from `clock.start`/`clock.dur`, so no key carries a hand-kept time.
  `unit.mjs` pins this whole surface against this row, member for member, the same way
  the scene's row is pinned.
- `NAKATOMIC.splats(buffer)` - the page-side twin of `tools/jsp.mjs`: `{ points, colors }`,
  one splat per voxel, in run order. Asserted against the Node tool, so both sides match.
- `NAKATOMIC.lobbyWorld()` - the arcade band, cached once, with its own occupancy map:
  exactly `{ voxels, batchVox, countVox, ids, floorCount, glowCount, treeCount,
  lightsCount, starCount, fountainCount, treeCells, treeMinY, treeTopY, starCell,
  glowCells, fountainCells, waterCells, waterBand, waterFootprint }`. `countVox` is the
  sum of the parts; `waterCells === ground().waterVolume` because the pool belongs to the
  ground batch. The glow uses the glass's own lit id, one cell behind the glass line
  (`glass.cells` is checked at build time, and the tests check the tree, glow and
  fountain cells against `envelope.isOutside`).
- `NAKATOMIC.plazaDressing()` - the arrival-court batch, cached once: exactly
  `{ voxels, batchVox, countVox, ids, lane, vehicleCells, marqueeCells, lightCells,
  vehicleCount, marqueeCount, lightCount, vehicleMinY, marqueeZ, beamY }`. It is the
  mirror of the lobby batch on the camera side of the contract: every cell passes
  `envelope.isOutside`, stands on the block (`isOnGround`), and re-claims nothing the
  ground batch or the glass line owns - all three are checked in the tests. The lane
  is `{ x -20..20, z 20..24 }`: the court outside the 2 m skirt, clear of the pool,
  the kerbs and the palm grove. The lamps and marquee banner glow with the glass's
  own lit id.
- `NAKATOMIC.roofWorld()` - the roof batch, cached once: exactly `{ voxels, batchVox,
  countVox, ids, stackCells, runCells, heloCells, lightCells, stackCount, runCount,
  heloCount, lightCount, stackMinY, heloMinY, heloTopY, hover, roofline }`. `roofline`
  echoes the raw geometry the batch was drawn from - the stacks, the pad, the disc and the
  winch - beside the cell lists the tests walk. Above the deck the
  envelope is a floor, not a wall - the claim guard refuses anything at or below
  `roofDeck`, and the tests pin every cell against `envelope.isOutside`, the upper
  shaft bounds, and the penthouse box. The stacks are the glass the tile helo pulled
  off the curtain wall, so they wear the pinned `shatter` id (`0xd003`) rather than a
  new allocation; the helo's winch line drops to a panel at deck height and its
  lights glow warm.
- `NAKATOMIC.fx` - the blast and the storm, the one batch that is not a batch: a
  function of `t`. Exactly `{ ids, window, flashWindow, pane, paneCells, flashCells,
  shardCells, at }`, and every cell wears the pinned `shatter` id `0xd003`. The panes
  are a rectangle of the atrium face, x -6..6, storey bands 5..8, and each one is
  looked up in `glass.cells` - a mullion cell can not become a broken pane. Shards
  enter at z -18, already clear of the shaft skirt at -16, drift out along -z by their
  own reach (3..7 cells) and fall to the terrace line at y 4; they never dip into the
  podium bands, whose skirt stands further out, so `envelope.isOutside` holds for every
  cell at every height the burst occupies. The overlay paints in its own `Points` pass
  over the cloud it replaces, and `scene.stats.fx` reports how many cells that frame
  drew - which is how the live driver proves the burst reached the pixels rather than
  only the data.
- `NAKATOMIC.convoy` - the response, staged (R19): `{ window, route, routeAt, routeLength,
  stage }`. `window` is the two fed beats read off the clock (`[485, 563]`), `route` is the
  17 waypoints the boulevard approach follows - axis-aligned legs only, from
  `(-23, street, block's south edge)` to the forecourt stop at `(-16, street, 24)`, dipping
  through the cut's free interior rows at y -2 and -1 because the bridge deck at y 0 is the
  ground's - and `routeAt(f)` answers the cell at arc-fraction `f` with `Math.floor`, so an
  interpolated float can never land a sample at street level inside the skirt. It is a data
  layer for Task 12's pull-back, not a path any object drives down.
  `NAKATOMIC.convoyWorld()` is the batch: 147 cells, 90 body + 48 band + 9 light-bar parts,
  9 FCPD cruisers in two rows (`frontRow` z 20, `backRow` z 23), 3 fed SUVs on the east kerb
  line, 13 cars, 18 light-bar cells (10 red, 8 blue), and the lead car two bands under the
  bridge in the sunken driveway.
- `NAKATOMIC.ensureWorld()` - builds the ground, lobby, dressing, roof and convoy batches
  into the shared buffer once and returns `{ ground, lobby, dressing, roof, convoy, bounds,
  voxels, buffer }`; a second call returns the same object.
- `NAKATOMIC.colorLinear(hex)` - the palette's sRGB hex in the renderer's working space:
  three 0..1 linear channels. `#ffcc77` goes out as `1, 0.6039, 0.1845`, `#ffffff` as
  `1,1,1`. One test runs every palette entry through it, because feeding the raw 0-255
  byte to the curve instead of the channel clamps every channel to 1 and the plaza
  renders as white sheets. The fx tasks read colours through this, not a private copy.
- `NAKATOMIC.audio` - the show's queue (R21): `queue` of `{ name, id, off, t }` entries
  sorted strictly ascending, `eventsBetween(prev, next)`, `pump(frame)`, `reset()`,
  `fired` (the crossings the page-side pump has counted), `live`, `unlock()` and `voices`
  (`whomp`, `crack`, `siren`, `glass`, `engine`, `room`). Entries are keyed to the beat
  table: `t = clock.start(id) + off`, and the build gate rejects any entry whose beat is
  not in `clock.order`, whose window it misses, or whose `hold` flag disagrees with
  `t >= BEAT_END`. `unlock()` is the only path that creates an AudioContext, and only a
  gesture handler calls it; `pump` counts crossings and stays silent with no context, so
  the queue is testable with no browser. The live driver's take asserts `fired` equals the
  queue length in one full run.
- `NAKATOMIC.hud` - the HUD's text as pure functions: `label(f)` (the beat's label, or
  `HOLD_LABEL` when `beatAt()` is null - R14's hold is not a missing label - and `""`
  before show start), `meta(f, opts)`, `stat(opts)` and `text(f, opts)`. `opts` carries
  `source`/`framing`/`framings`/`paused`; the scene's own `label()` defers to `hud.label`,
  so one fallback rule governs both.
- `NAKATOMIC.scene` - exactly `start rebuild running paused follow stats camera gl fov
  framing cameraSource setFraming setPose step label togglePause restart domElement`.
  `stats` is `{ points, voxels, fps, fx }`; `step(dt)` is the one-frame function the rAF loop
  wraps, so the pixel gates drive the same code path as the page. `stats.fx` is the overlay's
  per-frame cell count (Task 10) - the number the live driver compares against
  `fx.at(t).length` to prove the burst painted rather than only counted. `label(f)` answers
  `HOLD_LABEL` when `beatAt()` is null, and the camera never comes to rest inside the tower
  envelope. `cameraSource` names the camera that painted the current frame: `take` when
  `step()` is unpaused and carries a beat to key (the rig, through `setPose`), `lens` when a
  tool pins a pose, `framing` when one of the four orbit wide shots is live. The page boots
  itself: the fragment adds one `document.addEventListener("DOMContentLoaded", …start())`, so
  a person opening `index.html` sees the show rather than the shell, and the two live tools
  assert `running` instead of starting the show for the page (R24).

Appendix B is the beat table the clock fragment carries verbatim.

## Appendix A: palette (the dusk set)

| id | hex | use |
| --- | --- | --- |
| sky | `0x241b32` | dusk cloud deck |
| skyLit | `0x3a2b4a` | horizon glow |
| concrete | `0x6b6f78` | tower spandrel |
| mullion | `0x2c3038` | curtain-wall frame |
| glassDark | `0xd001` | unlit curtain-wall cells, `#2b3243`, the dusk sky in the pane |
| glass | `0xd002` | lit curtain-wall cells, `#ffcc77`, the warm interior glow |
| glassShatter | `0xd003` | post-blast shards, `#e8f4ff` - in use since Task 10 |
| wet | `0x15181f` | wet plaza / asphalt |
| cruiser | auto | `#191c23`, the black-and-white bodies |
| cruiserBand | auto | `#c4c9d4`, the light band on a cruiser's side |
| fed | auto | `#20242d`, the fed SUVs |
| fedGlass | auto | `#39424f`, the SUV glass |
| lightRed | auto | `#e0453c`, one lightbar cell (v1's `brake` row, as one id per cell) |
| lightBlue | auto | `#3d76e0`, the other lightbar cell |
| marker | auto | `#d8b23c`, the lead car's amber marker |

The rows above are the dusk set the plan asked for; what the fragments actually claim is
one call to `palette.id(hex)` or `palette.define(id, hex)` per material, and the non-glass
ids are auto-allocated from `0x0100` up. Two of the sky rows are not palette entries at
all: dusk sits in the renderer's clear colour and `FogExp2`, both `#0a0c12`, and the far
city's window bands carry the warm (`#8a6a4a`). Treat this appendix as the intent, and
read `src/0[3-9]*.txt` and `src/1[0-9]*.txt` for what is in the buffer.

One rule about the two responder-light hexes: they are single-cell ids on the lightbar band
and never body paint. A saturated red or blue on a body band would put permanent responder
colour in every frame, and the pixel gates that read the convoy would stop being delta
measurements. The same hazard with the other direction of the same palette: the pale cool
ids can not be used on anything that stands still, because the shatter gates count cool
pixels.

The gate test in Task 2 fails if any scene id lands at `0xe001` or above. The glass block
runs `0xd001` to `0xdfff`; anything at `0xe001` and up is reserved and never used by
scene geometry.

## Appendix B: beat table (v2 reconstruction, Jon-reviewable)

Same numbers as the plan's Appendix A: 24 beats, durations sum 715, `blast` at 360,
`storm` 390-485 (dur 95), HOLD 20, SHOW_LEN 735, FADE_START 729. The clock fragment in
`src/06-clock-beats.txt` carries that table verbatim and Task 6's first test pins it.
