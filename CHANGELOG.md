# Changelog

## 2026-11-03

- **Upgraded to Strata engine 0.1.56 / Control 0.1.56** (was 0.1.46). Fixed a crash-loop from four stale
  `0.1.47`/`0.1.52` path refs in the run config (`--expert-profile`, `cwd`, `vision.exe`). Rollback to 0.1.52 kept.
- **Drafter A/B'd and closed: MTP stays.** DFlash2 (the 0.7 GB Q4_0 drafter new to 0.2.10) runs on this CC 6.1 pair
  (`strata drafting plan` reports `serves: true`), but it is **slower** than MTP: 34.4/41.2 vs 36.9/46.1 tok/s at 2K/8K.
  Sweeping its `--draft-conf` (0.35/0.65/0.8) raised acceptance 95%→99% but decode barely moved. Both drafters also ran
  `strata tune auto` → `default_confirmed` each. **Keep MTP at `--spec 4 --spec-min-p 0.5`.**
- **New 512-token steady-state bench (`hbench512.py`).** The old harness sampled 128 tokens; this one samples 512 so the
  first-token ramp is diluted and we measure true steady state. On the stock config it reproduces the long-prompt
  steady-state ceiling: **47.5 tok/s @ ~9.7K prompt, 37.4 @ ~2K**. This is the box's honest ceiling on stock config.
- **Single-stream sweep: every knob is net-negative.** `--spec 6` (33.7/43.5), `--pcie-frac 0.35` (32.6/42.4), and the
  combo (29.3/38.6) all lose to stock (37.4/47.5). `--spec 6` drafts more tokens at lower acceptance and the wider verify
  costs more than it saves; `--pcie-frac 0.35` routes more of the expert cache over the slow link, trading a fast-GPU
  cache for a slow one. **Stock (spec 4, pcie 0.10) is the measured winner; 50 tok/s is a structural/hardware goal, not
  a tuning one.**
- **New finding: both cards negotiate PCIe 1.0 (2.5 GT/s), not Gen3.** `LnkCap` is 8 GT/s (Gen3-capable) but `LnkSta` is
  2.5 GT/s on both 1070s. This contradicts the earlier "Gen3 x16, 12.1 GB/s" assumption in the Machine table and item #1.
  Likely a slot-wiring / BIOS / riser issue, not a card limit. **Not yet re-benched** — if the link recovers to Gen3 the
  `--pcie-frac` optimum and the decode ceiling may both move. See NOTES.md.

## 2026-10-22

- GDDR5 memory offset via NVML (no X server): +800 -> P2 memory 3802 -> 4201 MHz, decode ~30.6 -> ~32.6 tok/s
  (+5-6%), prompt +1-2%. One card first showed VRAM errors at +1200. New optional
  `recipe/05-memory-offset.sh` (helper, boot unit with an off switch, VRAM pattern test).
- 16 more A/B runs (rounds 8-11) in `results/ab-runs.csv`, 62 in total. Round 11 re-checked `--pcie-frac` 0.05 /
  0.15 around 0.10 with the offset on: 0.10 stays (32.35 vs 31.7 / 30.4).
- Huge pages: already transparent huge pages for the expert arena, so not pursued.

## 2026-10-21

- First public version.
- Engine 0.1.46 built for sm_61 with CUDA 12.9 and packaged as a local Strata component.
- Tuned from 27.2 tok/s (setup defaults, 64K) to ~31 tok/s at 128K. Winners: `--pcie-frac 0.10`, the English draft
  vocabulary, and `--kv k8v4 --max-context 131072 --kv-resident 32768`.
- 46 completed A/B runs in `results/ab-runs.csv`. Decode profile, KV/context sweep and long-prompt (~63K / ~101K)
  results in `results/README.md`.
