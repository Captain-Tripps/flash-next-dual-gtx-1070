# Loss record - nakatomi-plaza build (written 2026-11-24, ~23:15 CT)

## What was lost
The entire build directory `The Mercy Calculation\nakatomi-plaza` (source, tests, dist,
screenshots, `.git` with Tasks 1-6 commits, the 706-line plan file, per-task briefs and
task reports). Readable at ~22:00 with HEAD `60771b3`; gone by 22:12.

## Recovery checks - all negative
- Local disk: nothing named `nakatomi*` anywhere; all SID `$Recycle.Bin` folders empty of it.
- OneDrive logs (`%LOCALAPPDATA%\Microsoft\OneDrive\logs\Personal`, 140 files copied to temp):
  no `nakatomi` string in any readable log.
- OneDrive **cloud** (checked directly via browser):
  - cloud search `?q=nakatomi` - no hits
  - cloud Recycle bin, sorted by deletion date - no `nakatomi`, no `Mercy Calculation`
  (the bin is full of unrelated `ChatGPT\ds4-codex-2026-11-18\.git\...` folders)
  - cloud view of `Documents\Books` and `Documents\Books\The Mercy Calculation` -
  the build folder was **never** in the cloud view, even as a placeholder.
- Windows Defender quarantine and `Get-MpThreatDetection` - empty.
- USN journal - access denied (non-admin), so no delete audit trail.
- Scheduled tasks run in the last 24 h - none.
- OpenCode shell/storage logs - no `Remove-Item` against the build path (log grep was
  self-matching only).

Conclusion: nothing to restore. Cause of deletion unidentified; the same mechanism is
still a threat to the Books tree, so **do not rebuild inside OneDrive**.

## Rebuild location (user-approved)
`C:\dev\nakatomi-plaza` - plain local disk, outside OneDrive. Created 2026-11-24.

## Task 1-6 numbers to carry into the rebuild (from Task 6/Task 5 hand-off notes)
- Show clock: durations sum 715, `HOLD = 20`, `SHOW_LEN = 735`, `BEAT_END = 715`,
  `FADE_START = 729` (`SHOW_LEN - FADE_LEN`, i.e. last 6 s - **not** the doc's "719 to 735").
  `storm` dur 95 absorbs the slack. Design-doc durations are internally inconsistent
  (sum 675 vs 695) - trust the derived numbers above.
- `blast` starts at 360 (not the doc's 425) with storm 95. Derive timings via `seekTo(id)`,
  never from the doc's start column.
- `beatAt()` returns null during [715, 735] - audio events must sit below 715 or be
  labelled "hold"; beat labels need a hold fallback.
- Wrap uses a one-clamp grace window (`wrapAt = len + dtClamp`) so `fade.black === 1`
  is observable before the cut.
- Ruling 14: HOLD at end of show. Ruling 15: storm/blast timing. Ruling 16: fade to black
  before loop. Rulings 12/13: camera stays outside the tower envelope.
- Task 5 ground contract return shape:
  `{ voxels, batchVox, countVox, bounds, garageVolume, ditchVolume, plazaVolume, waterVolume,
  palmCount, skylineCount, streetY }` plus `isOnGround`; `countVox` 9,406;
  skyline ~30.4% of `countVox`; runs merge +X only, so skyline must be built as full-width
  horizontal splices.
- F3 palette gate fix: `0xe001` -> `0xd001` in `src/plaza/main.js` (was verified pre-loss).

## Tooling note
The old `agent_browser_*` MCP family stays disabled. The `browse` MCP is the web path;
it dropped out of the catalog twice today when the server restarted.
