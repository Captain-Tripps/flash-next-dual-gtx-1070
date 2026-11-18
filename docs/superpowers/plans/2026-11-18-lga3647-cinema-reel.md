# LGA 3647 Cinema Reel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `?cinema=1` deterministic cinema mode on the showcase page and a capture driver that produces a 40.000 s, 1920×108060 fps MP4 for X.

**Architecture:** The page gains a pure keyframe table (`cinemaState(ms)`) driving camera pose, plate/latch angles, and card opacity, plus a one-call `renderCinemaFrame(ms)`. The film driver spawns a private headless Chrome over raw CDP (Node 24 global `WebSocket`, no npm deps), frame-steps 1200 deterministic screenshots, and ffmpeg muxes JPEG frames to H.264 MP4. The encoded file is gated with `ffprobe` + raw-pixel decode of extracted frames.

**Tech Stack:** WebGL 2 inline module (index.html), Node 24 ESM harnesses, raw CDP over global WebSocket, Chrome 157 (`C:\Program Files\Google\Chrome\Application\chrome.exe`), ffmpeg/ffprobe at `C:\Users\jstap\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-9.0.2-full_build\bin\` (glob-resolved).

**Spec:** `DESIGN.md` "Addendum 2026-11-18: cinema reel" (beat sheet, timings, verification rules live there).

## Global Constraints

- Zero dependencies: no `import`/`export`/`fetch`/external script in the page (unit test `page_has_no_external_module_or_fetch` must stay green).
- Default mode behavior unchanged: cinema code activates only under `?cinema=1`, guarded so the unit sandbox (no `location`) still boots. `preserveDrawingBuffer:true` is passed **only** in cinema mode.
- Exact copy, verbatim from Jon: title card `LGA 3647 — 3,647 gold contacts` (spaced hyphen per voice rules: `LGA 3647 - 3,647 gold contacts`), credit card lines `Dual GTX 1070's` and `Qwen3.8 Flash Next Strata`.
- Reel: 1920×1080, 60 fps exactly, duration 40.000 s (frame = `index * 1000/60`, 1200 frames, last frame ms = 39983.33 < 40000), silent, `-movflags +faststart`, libx264 crf 17 preset slow, yuv420p.
- Output MP4 and frames live under `.superpowers/film/` and `reel/` — never committed to git.
- All timing values in ms, camera angles in degrees, distances in mm to match existing `VIEW`/`CAMERA_LIMITS`.
- Test command stays `node verify/unit.mjs` / `node verify/render.mjs` / `node verify/all.mjs`; whole suite must be green before each commit.

## Review Focus

- **Sandbox has no `location`:** default unit boot must not throw on cinema-flag reading — pinned by a boot-with-stub test in Task 1.
- **Frame-step race:** with cinema mode active the page must **not** run its rAF loop, or a wall-clock frame could repaint between `renderCinemaFrame` and the screenshot — pinned by asserting an empty rAF queue under `?cinema=1` in Task 1.
- **Timeline boundary:** `cinemaState(39983)` must be a valid pose (not NaN/out-of-range) — pinned in Task 1.
- **Encoder discovery must not hard-crash:** ffmpeg resolved by glob under the WinGet Packages dir, driver exits with a named error if missing — Task 2.
- **Encoded artifact truth:** duration/size/`ffprobe` streams + gold-pixel ratio of a raw-decoded mid-reel frame — Task 2's film gate.

---

### Task 1: Cinema mode in the page (`index.html` + `verify/unit.mjs`)

**Files:**
- Modify: `index.html` (CSS block, body markup after `#hud`, module end near `window.__api`)
- Test: `verify/unit.mjs`

**Interfaces:**
- Produces:
  - `window.__api.cinemaMode` — boolean, `true` only under `?cinema=1`.
  - `window.__api.cinemaState(ms)` → `{ camera: {azDeg, elevDeg, dist}, plateAngleDeg, latchAngleDeg, phase, titleAlpha, creditAlpha, fadeAlpha }` — pure, deterministic, clamped inside `CAMERA_LIMITS`.
  - `window.__api.renderCinemaFrame(ms)` → same record; applies camera via `updateCamera`, plate via `applyPlatePose`, writes card DOM opacities, calls `drawScene`.
  - `CINEMA = { durationMs: 40000, cameraKeys, plateKeys, cards }` exported.
  - Body markup: `#cinema-fade` (black layer), `#cinema-title`, `#cinema-credits` (two `.line` children); hidden unless `body.cinema`; `body.cinema #hud { display: none; }`.
  - Boot under cinema: `body.classList.add("cinema")`, **no** `startRenderLoop`, **no** `attachCameraInput`, `getContext("webgl2", { preserveDrawingBuffer: true })`.
- Keyframe values (exact, from the DESIGN.md beat sheet):
  - `cameraKeys`: `[0: 34/56/150, 9500: 96/50/132, 13000: 118/28/62, 18000: 150/20/78, 23000: 196/38/60, 27500: 224/50/150, 33000: 262/58/140, 36500: 340/56/150]` — az monotonic across the 360° arc (no wrap cut), all interpolated with `easeInOut`.
  - `plateKeys`: `0→9500: 0/latch 0; 9500→11000: latch 0→18; 10800→15500: plate 0→105; 15500→26500: hold 105/latch 18; 26500→30500: plate 105→0; 30500→32000: latch 18→0; end: 0/0`. Phases: `closed | unlatching | opening | open | closing | latching | closed`.
  - `cards`: fade `0→800: 1→0` and `39300→40000: 0→1`; title `900→2600: 0→1`, `2600→3300: 1→0`; credits `36500→37500: 0→1`, `39000→39600: 1→0`.

- [ ] **Step 1: Write failing unit tests** in `verify/unit.mjs`, using the sandbox pattern; extend `makeSandbox` with `location: { search: "" }` and a `boot({ locationSearch })` option that feeds `location.search`:
  - `cinemaState_withTimelineMs0_returnsClosedPlateAndHeroCamera` → assert plate 0, latch 0, camera `{azDeg: 34, elevDeg: 56, dist: 150}`, fadeAlpha 1, titleAlpha 0.
  - `cinemaState_atLatchPushIn_returnsCameraWithinLimitsAndUnlatching` → at `12000`: camera within `CAMERA_LIMITS` (dist between 45 and 280, elev between 5 and 75), `latchAngleDeg > 10`, `plateAngleDeg > 0`.
  - `cinemaState_fullTimeline_plateSweepCoversFullRangeAndReturnsClosed` → scan `0..40000` step 100: max plate ≥ 104.9, final `plateAngleDeg === 0`, all azimuth values finite and monotonic non-decreasing.
  - `cinemaState_atLastFrame_isFinite` → `cinemaState(39983.333)` all fields finite.
  - `boot_withLocationCinema1_disablesAutoLoopAndMarksBody` → sandbox `location.search = "?cinema=1"`: `document.body` classList contains `"cinema"`, `boot().pumpFrame` throws "no rAF callback queued", `scene.frames` stays 0 after the boot; `window.__api.cinemaMode === true`.
  - `boot_withoutLocation_searchStaysDefaultAndLoopQueues` → default sandbox: rAF queue non-empty (existing behavior), `cinemaMode === false`.
  Run `node verify/unit.mjs`; expect the new tests RED (`cinemaState` undefined / no cinema class).

- [ ] **Step 2: Implement cinema mode in `index.html`.** CSS: card/fade/HUD-hiding rules; body markup the three card nodes with Jon's exact copy strings. Module: guard-flag reading `const cinemaRequested = typeof location !== "undefined" && /[?&]cinema/.test(location.search)`; `CINEMA` tables; `cinemaState(ms)` table interpolation (find keyframe pair, `easeInOut` the span); `renderCinemaFrame(ms)`; boot branches as in Interfaces; export both on `__api`. Reuse `updateCamera`, `applyPlatePose`, `drawScene`, `easeInOut` — no duplicate math.

- [ ] **Step 3: Run `node verify/unit.mjs`** — expect 66 + 6 new = 72/72 green. Also `node verify/render.mjs` — the 12 existing checks must be untouched (they boot without `?cinema=1`).

- [ ] **Step 4: Commit** `index.html verify/unit.mjs DESIGN.md` as `feat: deterministic cinema mode (?cinema=1) for the showcase reel`.

### Task 2: Film driver + encode + film gate (`verify/film.mjs`)

**Files:**
- Create: `verify/film.mjs`
- Test: `verify/film.mjs --gate` (self-check on the encoded artifact; also usable as the whole capture path)

**Interfaces:**
- Consumes: `window.__api.renderCinemaFrame(ms)`, `window.__api.cinemaState(ms)`, `?cinema=1` boot from Task 1.
- Produces: `.superpowers/film/frame-NNNN.jpg` (1200 frames), `reel/lga3647-reel.mp4`.
- Chrome flags: `--headless=new --remote-debugging-port=9334 --window-size=1920,1080 --force-device-scale-factor=1 --allow-file-access-from-files` (spawn detached, wait for `/json/version`).
- CDP flow: `Target.createTarget` → `Page.navigate file:///…/index.html?cinema=1` → wait load → for frame `i` in `0..1199`: `Runtime.evaluate` `window.__api.renderCinemaFrame(i*1000/60)` (await, no object group), then `Page.captureScreenshot {format:"jpeg",quality:95,fromSurface:true}` → append base64 to file.
- ffmpeg args: `-framerate 60 -i frame-%04d.jpg -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart reel/lga3647-reel.mp4` (no audio stream).
- Gate: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames:format=duration -of json`; assert width 1920, height 1080, `r_frame_rate` "60/1", `nb_frames` 1200, duration 40.0±0.15. Then extract raw frame: `ffmpeg -ss 22 -i reel/lga3647-reel.mp4 -frames:v 1 -f rawvideo -pix_fmt rgb24 frame.rgb`; node reads 1920*1080*3 bytes and applies the render-suite gold definition (`r > b + 20 && g > 60`) over every 8th pixel: expect `goldRatio >= 0.03` (mid-reel macro beat must survive H.264).

- [ ] **Step 1: Write the failing gate** — run `node verify/film.mjs --gate` with no MP4 present; expect exit 1 with "reel/lga3647-reel.mp4 not found".
- [ ] **Step 2: Implement the capture path per Interfaces.** ffmpeg/chrome exe discovery like `findAgentBrowser()` in render.mjs (env override + glob fallback, named error when missing). Keep the CDP socket handling in one small `cdpConnection` helper: `send(method, params)` → Promise over global `WebSocket` messages; reusing it for both evaluate and screenshot.
- [ ] **Step 3: Run `node verify/film.mjs`** — 1200 frames captured, ffmpeg prints size, exit 0.
- [ ] **Step 4: Run `node verify/film.mjs --gate`** — expect all ffprobe assertions + gold ratio green (RED first if the ratio band is off: re-tune from the measured value, per the re-measure-after-fix lesson).
- [ ] **Step 5: Visual evidence** — `ffmpeg -ss` PNG extract at 3 s (title card visible), 14 s (plate open), 37 s (credits visible); `read` the PNGs to confirm composition, plate state, card copy legibility.
- [ ] **Step 6: Commit** `verify/film.mjs .gitignore reel/ entry` as `feat: cinema reel capture driver (CDP frame-step + ffmpeg mux)`.

### Task 3: Suite acceptance, ledger, tweet caption draft

**Files:**
- Modify: `.superpowers/sdd/2026-11-17-lga3647-socket-showcase/progress.md` (ledger, untracked)
- Create: `.superpowers/caption-x-reel.md` (draft, untracked — never posted)

**Interfaces:** Consumes Task 1+2 commits.

- [ ] **Step 1: Full suite** `node verify/all.mjs` — expect `ALL SUITES: pass` (72 unit + 12 render).
- [ ] **Step 2: Ledger entry** — cinema mode + film pipeline + gate values recorded.
- [ ] **Step 3: Caption draft** in Jon's voice per `voice-routing.md`: read `~/.config/ghostwriter/jon-staples/soul.md` + `x-twitter.md` first; a short X post referencing the reel; draft only, **do not post anywhere**.

## Self-review notes

Spec coverage: beat sheet → Task 1 keyframes; capture → Task 2; X-ready + captions → Task 3. Copy strings verbatim in Global Constraints. Types consistent: `renderCinemaFrame` returns the `cinemaState` record in both.
