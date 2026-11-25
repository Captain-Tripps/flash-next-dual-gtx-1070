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
- **Glass palette block.** Curtain-wall and shatter ids live in the reassigned `0xd001`
  block (v1 fix F3, `0xe001` -> `0xd001`). `0xe001` and above is reserved and the palette
  gate rejects any geometry that uses it.

## 4. Canonical dimensions (set here, consumed by every later task)

Voxel scale: 1 unit horizontally = 1 m; 1 unit vertically = one storey band
(~3.7 m floor-to-floor), so the curtain wall reads as stacked storey bands, the
way the real plaza does. Street level (`streetY`) is y = 0.

| Feature | x | z | y bands |
| --- | --- | --- | --- |
| Sunken garage lot floor | - | - | y = -6 (lot floor), driveway/ditch floor y = -3, bridge deck y = 0 |
| Podium (4 storeys, arcades + lobby) | -20..20 | -17..17 | 0..3, deck at y = 4 |
| Shaft, lower (storeys 1-24) | -12..12 | -12..12 | 4..27 |
| Shaft, setback band (storeys 25-35) | -10..10 | -10..10 | 28..38 |
| Shaft, upper (storeys 36-42) | -11..11 | -11..11 | 39..45 |
| Roof deck | - | - | y = 46 |
| Roof mechanical penthouse | -9..9 | -9..9 | 47..49 |

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
- `NAKATOMIC.glass` - `cells`/`litFraction`/`lit(id)`.
- `NAKATOMIC.ground()` - exactly `{ voxels, batchVox, countVox, bounds, garageVolume,
  ditchVolume, plazaVolume, waterVolume, palmCount, skylineCount, streetY }`, with
  `countVox === 9406` and `skylineCount === 2860` (30.4 % of the ground batch), plus
  `NAKATOMIC.isOnGround(x, z)`.
- `NAKATOMIC.clock` - `BEATS`/`order`/`start(id)`/`dur(id)`/`seekTo(id)`/`beatAt(t)`/`len`/
  `BEAT_END`/`HOLD`/`SHOW_LEN`/`FADE_START`/`FADE_LEN`/`fade`/`wrapAt`/`tick(dt)`.
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
