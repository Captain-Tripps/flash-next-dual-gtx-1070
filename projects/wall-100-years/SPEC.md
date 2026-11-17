# THE WALL - 100 YEARS IN 15 SECONDS

Spec for a 15-second procedural film. Everything on screen is computed from
simulation math. No diffusion model, no stock footage, no captured video.

## The idea (mine)

One object. One wall of brick, standing in an empty field, filmed from a fixed
tripod position while 100 years pass across it in 15 seconds. The camera never
moves - the century does. What interests me is that decay is not random: it is
ordered. Mortum cures then cracks, soot accumulates in rings from the ground up,
mortar joints erode before faces spall, vegetation grows from the top down and
from the ground up at once. So I am not faking decay with noise - I'm running a
small deterministic model of a wall aging, and letting 100 years of it play out.

The film has one rule: nothing on screen is arbitrary. Every mark on the wall is
the result of a parameterized process with a seed, an age curve, and a rate.

## Hard technical constraints

- 15.000 s exactly. 30 fps, 450 frames. 1920x1080. Constant frame rate.
- Year range: 1926 -> 2026 (one century, matching the actual year).
- Every frame deterministic from seed `7311`. Same input, same output, always.
- Audio: synthesized in-code only (low bed + crack/creak events + one resolved
  chord at the end). No samples.
- Look: "observatory film from 1974". Warm -> cold palette, film grain, slow
  vignette breathing, single title card, no cuts, no zooms.

## Shot structure (single continuous shot, 3 phases)

| time   | phase         | what happens |
|--------|---------------|--------------|
| 0-2s   | FOUNDING      | wall is new: crisp mortar, warm lime-dust haze, formwork lines still on the surface. Year counter runs slow (1926...1931). |
| 2-10s  | THE CENTURY   | all processes run at once; counter acceler to ~4 yr/s. Soot ring climbs, joints erode, faces spall, cracks propagate from the corners, moss creeps down from the parapet, a leaf grows up the north face. Weather extremes flash as light shifts (rain -> hard sun -> snow, each a band of frames). |
| 10-15s | RESOLVES      | processes slow, counter stops at 2026, camera settles, one warm shaft of low sun lands on the wall, title card fades in: "ONE HUNDRED YEARS / THE WALL". Grain thickens, vign closes. |

No cuts. One shot. The only movement is the light and the aging.

## The simulation (per-pixel-ish, computed, not painted)

1. **Brick field** - 24 courses x 96 wythes, each with seeded hue/sat/roughness,
   header/stretcher alternation per course, subtle per-brack bowing from the
   century of settling (a slow sine applied to the whole wall).
2. **Mortar joints** - concave profile drawn as a light ribbon. Erosion model:
   joint depth `d(t) = d0 * (1 - k*salt^1.6*t)` with wind-driven asymmetric
   loss; joints thin and their shoulders chip until they vanish.
3. **Soot / grime** - capillary rise model: darkness falls as an exponential
   decay from the ground plus a rain-wash streak field per wythe (each wythe has
   its own seeded channel that either stains or shields). Soot front climbs over
   the first 40 years, then slows as it runs out of fuel.
4. **Spall & crack propagation** - corner-initiated cracks: each crack has a
   seeded path (recursive branching on the brick grid) and starts at a chosen
   year; its length grows with `t` along that path. Brick faces pop off where
   crack lines cross, exposing a pale inner color.
5. **Vegetation** - two systems: moss as a reaction front descending from the
   parapet (needs damp > threshold), and one climbing plant whose stem follows a
   deterministic growth recursion with seeded leaf placement, sprouting from the
   base at year ~38 and reaching the parapet in the last third.
6. **Effloriscence / salt bloom** - pale crystalline patches where joints have
   gone through, appearing only after joint erosion passes a threshold.
7. **Weather bands** - light color temperature + exposure driven by a seeded
   step function of time (rain band: cool + high contrast; sun band: warm + lift;
   snow band: flat + lifted blacks). Never cuts, always dissolves.
8. **Century pass** - global: warm ochre -> cold desaturated blue-grey via a
   palette LUT keyed to elapsed years, plus vignette that tightens with age.

## Post (deterministic, in-code)

- Film grain: seeded per-frame luma noise, amplitude rises ~2x from start to end.
- Halation: warm channels bleed slightly at the brightest edges.
- Vignette + slight breathing (period ~11s, so it never looks looped).
- Year counter: 7-segment-ish monospace digits drawn as vectors, ticking with a
  small mechanical jitter; decade digit flips are given a 2-frame flash.
- Title card: same vector font, letter-spacing opens slowly.

## Deliverables

- `wall.mp4` - H.264, yuv420p, CRF ~18, faststart, audio AAC 192k. Exactly 15s.
- `render.mjs` - the renderer (single file, no deps beyond Node builtins).
- `SPEC.md` - this file.
