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
  the glass-break shatter lives inside that window and restores on the wrap.
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
  plan creates the page's render loop (renderer, `THREE.Points` from `toSplats`, the rAF
  loop that calls `clock.tick`, the camera driven by the rig, and the HUD/fade elements),
  yet Task 14's render gate needs pixels. Ruling: that wiring lands in Task 13, the task
  whose HUD text is driven by `beatAt()` - the first live-loop consumer - with the rig
  output from Task 12 feeding it. Nothing in Tasks 7-12 may add a renderer of its own.
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
- `NAKATOMIC.rig` - `keys(id)`, `sample(id, t)`; one continuous take, fov clamped 35..60.

Appendix B is the beat table the clock fragment carries verbatim.

## Appendix A: palette (the dusk set)

| id | hex | use |
| --- | --- | --- |
| sky | `0x241b32` | dusk cloud deck |
| skyLit | `0x3a2b4a` | horizon glow |
| concrete | `0x6b6f78` | tower spandrel |
| mullion | `0x2c3038` | curtain-wall frame |
| glass | `0xd001` | lit curtain-wall cells (the glass block) |
| glassDark | `0xd002` | unlit cells |
| glassShatter | `0xd003` | post-blast shards |
| lobby | `0xffcc77` | lobby glow |
| wet | `0x15181f` | wet plaza / asphalt |
| brake | `0xc050` | police flash bar (scene id, below the glass block) |

The gate test in Task 2 fails if any scene id lands at `0xe001` or above. The glass block
runs `0xd001` to `0xdfff`; anything at `0xe001` and up is reserved and never used by
scene geometry.

## Appendix B: beat table (v2 reconstruction, Jon-reviewable)

Same numbers as the plan's Appendix A: 24 beats, durations sum 715, `blast` at 360,
`storm` 390-485 (dur 95), HOLD 20, SHOW_LEN 735, FADE_START 729. The clock fragment in
`src/06-clock-beats.txt` carries that table verbatim and Task 6's first test pins it.
